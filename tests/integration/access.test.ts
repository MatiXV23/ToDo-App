import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { appAccess, notifications, session, user } from "@/server/db/schema";
import { checkAccess, decideAccess, listAccess } from "@/server/services/access";
import { authenticateApiToken, createApiToken } from "@/server/services/api-tokens";
import { inviteMember } from "@/server/services/members";
import { as, createTestProject, createUser, type TestUser } from "./helpers";

async function createAdmin(): Promise<TestUser> {
  const id = randomUUID();
  await db.insert(user).values({ id, name: "Admin", email: "admin@test.local", emailVerified: true });
  return { id, name: "Admin", email: "admin@test.local" };
}

const accessRequests = (userId: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, "access_request")));

describe("acceso a la app", () => {
  it("quien entra sin acceso deja una solicitud y el admin recibe un solo aviso", async () => {
    const admin = await createAdmin();
    const person = { email: "Nueva@Gmail.com", name: "Nueva", image: "https://img/nueva.png" };

    expect(await checkAccess(person)).toEqual({ ok: false, reason: "pending" });
    expect(await checkAccess(person)).toEqual({ ok: false, reason: "pending" });

    const [row] = await db.select().from(appAccess).where(eq(appAccess.email, "nueva@gmail.com"));
    expect(row).toMatchObject({ status: "pending", name: "Nueva", image: "https://img/nueva.png" });
    const avisos = await accessRequests(admin.id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].data).toMatchObject({ email: "nueva@gmail.com", name: "Nueva" });

    const list = await listAccess(as(admin));
    expect(list.pending.map((p) => p.email)).toEqual(["nueva@gmail.com"]);
    expect(list.admins.map((a) => a.email)).toEqual(["admin@test.local"]);
  });

  it("el admin aprueba y la persona puede entrar; el aviso queda leído", async () => {
    const admin = await createAdmin();
    await checkAccess({ email: "nueva@gmail.com", name: "Nueva" });
    await decideAccess(as(admin), { email: "nueva@gmail.com", approve: true });

    expect(await checkAccess({ email: "nueva@gmail.com" })).toEqual({ ok: true });
    const [aviso] = await accessRequests(admin.id);
    expect(aviso.readAt).not.toBeNull();
  });

  it("al quitar el acceso se cierran sus sesiones y dejan de andar sus tokens", async () => {
    const admin = await createAdmin();
    const member = await createUser("Miembro");
    await db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: member.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { token } = await createApiToken(member.id, { name: "Claude" });
    expect(await authenticateApiToken(token)).not.toBeNull();

    await decideAccess(as(admin), { email: member.email, approve: false });

    expect(await checkAccess({ email: member.email })).toEqual({ ok: false, reason: "denied" });
    expect(await db.select().from(session).where(eq(session.userId, member.id))).toHaveLength(0);
    expect(await authenticateApiToken(token)).toBeNull();
    // Rechazado: nuevos intentos no vuelven a avisar.
    expect(await accessRequests(admin.id)).toHaveLength(0);
  });

  it("solo el admin decide, y los admins siempre tienen acceso", async () => {
    await createAdmin();
    const someone = await createUser("Alguien");
    await expect(decideAccess(as(someone), { email: "x@gmail.com", approve: true })).rejects.toThrow(/administrador/);
    await expect(listAccess(as(someone))).rejects.toThrow(/administrador/);
    expect(await checkAccess({ email: "ADMIN@test.local" })).toEqual({ ok: true });
  });

  it("si el admin invita a alguien a un proyecto, queda con acceso", async () => {
    const admin = await createAdmin();
    await db.insert(appAccess).values({ email: admin.email, status: "approved" }).onConflictDoNothing();
    const { project } = await createTestProject(admin);
    await checkAccess({ email: "invitada@gmail.com" });
    await inviteMember(as(admin), { projectId: project.id, email: "invitada@gmail.com", role: "editor" });
    expect(await checkAccess({ email: "invitada@gmail.com" })).toEqual({ ok: true });

    // Si invita otra persona, sigue haciendo falta la aprobación del admin.
    const owner = await createUser("Dueña");
    const other = await createTestProject(owner);
    await inviteMember(as(owner), { projectId: other.project.id, email: "otra@gmail.com", role: "viewer" });
    expect(await checkAccess({ email: "otra@gmail.com" })).toEqual({ ok: false, reason: "pending" });
    const list = await listAccess(as(admin));
    expect(list.pending.find((p) => p.email === "otra@gmail.com")?.invitations).toEqual([
      { email: "otra@gmail.com", project: other.project.name, invitedBy: "Dueña" },
    ]);
  });

  it("Better Auth no crea usuarios ni sesiones sin acceso", async () => {
    await createAdmin();
    const ctx = await auth.$context;
    await expect(
      ctx.internalAdapter.createUser(
        { email: "intrusa@gmail.com", name: "Intrusa", emailVerified: true },
        { method: "oauth" },
      ),
    ).rejects.toMatchObject({ body: { code: "access_pending" } });
    expect(await db.select().from(user).where(eq(user.email, "intrusa@gmail.com"))).toHaveLength(0);

    const member = await createUser("Miembro");
    expect(await ctx.internalAdapter.createSession(member.id)).toMatchObject({ userId: member.id });
    await db.update(appAccess).set({ status: "denied" }).where(eq(appAccess.email, member.email));
    await expect(ctx.internalAdapter.createSession(member.id)).rejects.toMatchObject({
      body: { code: "access_denied" },
    });
  });
});
