import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { db, type Executor } from "@/server/db";
import { appAccess, notifications, projectInvitations, projects, session, user } from "@/server/db/schema";
import { env } from "@/server/env";
import { badRequest, forbidden } from "@/server/errors";
import { publish, userChannel } from "@/server/events";
import type { Actor } from "@/server/permissions/access";
import { notify } from "./notifications";

/**
 * Acceso a la app: solo entran los emails aprobados por un admin (ADMIN_EMAILS).
 * Quien entra con Google sin acceso deja una solicitud pendiente que llega al buzón del admin.
 */

const emailSchema = z.email("Email inválido").transform((e) => e.trim().toLowerCase());

export const decideAccessSchema = z.object({ email: emailSchema, approve: z.boolean() });

export const isAdminEmail = (email: string) => env.adminEmails.includes(email.trim().toLowerCase());

export type AccessResult = { ok: true } | { ok: false; reason: "pending" | "denied" };

/**
 * Decide si un email puede iniciar sesión. La primera vez que alguien sin acceso lo intenta,
 * queda una solicitud pendiente y se avisa a los admins.
 */
export async function checkAccess(person: { email: string; name?: string | null; image?: string | null }): Promise<AccessResult> {
  const email = person.email.trim().toLowerCase();
  if (isAdminEmail(email)) return { ok: true };
  const [row] = await db.select({ status: appAccess.status }).from(appAccess).where(eq(appAccess.email, email));
  if (row?.status === "approved") return { ok: true };
  if (row) return { ok: false, reason: row.status };

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(appAccess)
      .values({ email, status: "pending", name: person.name || null, image: person.image ?? null, requestedAt: new Date() })
      .onConflictDoNothing()
      .returning();
    if (created) await notifyAdmins(tx, { email, name: created.name, image: created.image });
  });
  return { ok: false, reason: "pending" };
}

/** Como checkAccess, pero sin registrar solicitudes (para tokens de API). */
export async function hasAccess(email: string) {
  if (isAdminEmail(email)) return true;
  const [row] = await db
    .select({ status: appAccess.status })
    .from(appAccess)
    .where(eq(appAccess.email, email.trim().toLowerCase()));
  return row?.status === "approved";
}

async function notifyAdmins(ex: Executor, data: { email: string; name: string | null; image: string | null }) {
  const admins = await ex.select({ id: user.id }).from(user).where(inArray(user.email, env.adminEmails));
  for (const admin of admins) await notify(ex, { userId: admin.id, type: "access_request", data });
}

async function requireAdmin(actor: Actor) {
  if (actor.type !== "user") throw forbidden();
  const [me] = await db.select({ email: user.email }).from(user).where(eq(user.id, actor.userId));
  if (!me || !isAdminEmail(me.email)) throw forbidden("Solo el administrador gestiona el acceso a la app");
  return actor.userId;
}

/** Solicitudes, personas con acceso y rechazadas, para la pantalla de administración. */
export async function listAccess(actor: Actor) {
  await requireAdmin(actor);
  const rows = await db
    .select({
      email: appAccess.email,
      status: appAccess.status,
      name: sql<string | null>`coalesce(${user.name}, ${appAccess.name})`,
      image: sql<string | null>`coalesce(${user.image}, ${appAccess.image})`,
      registered: sql<boolean>`${user.id} is not null`,
      requestedAt: appAccess.requestedAt,
      decidedAt: appAccess.decidedAt,
    })
    .from(appAccess)
    .leftJoin(user, eq(user.email, appAccess.email))
    .orderBy(desc(appAccess.requestedAt), asc(appAccess.email));

  // Si alguien pide acceso porque lo invitaron a un proyecto, el admin lo ve en la solicitud.
  const pendingEmails = rows.filter((r) => r.status === "pending").map((r) => r.email);
  const invitations = pendingEmails.length
    ? await db
        .select({ email: projectInvitations.email, project: projects.name, invitedBy: user.name })
        .from(projectInvitations)
        .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
        .innerJoin(user, eq(user.id, projectInvitations.invitedById))
        .where(and(inArray(projectInvitations.email, pendingEmails), eq(projectInvitations.status, "pending")))
    : [];

  const admins = await db
    .select({ email: user.email, name: user.name, image: user.image })
    .from(user)
    .where(inArray(user.email, env.adminEmails));

  return {
    admins: env.adminEmails.map((email) => {
      const u = admins.find((a) => a.email === email);
      return { email, name: u?.name ?? null, image: u?.image ?? null };
    }),
    pending: rows
      .filter((r) => r.status === "pending")
      .map((r) => ({ ...r, invitations: invitations.filter((i) => i.email === r.email) })),
    approved: rows
      .filter((r) => r.status === "approved" && !isAdminEmail(r.email))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    denied: rows.filter((r) => r.status === "denied"),
  };
}

export async function pendingAccessCount(actor: Actor) {
  await requireAdmin(actor);
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(appAccess)
    .where(eq(appAccess.status, "pending"));
  return row?.n ?? 0;
}

/**
 * Aprueba o quita el acceso de un email (aunque nunca haya pedido acceso: así se lo da
 * por adelantado). Al quitarlo se cierran sus sesiones abiertas.
 */
export async function decideAccess(actor: Actor, input: z.input<typeof decideAccessSchema>) {
  const { email, approve } = decideAccessSchema.parse(input);
  const adminId = await requireAdmin(actor);
  if (isAdminEmail(email)) throw badRequest("Los administradores siempre tienen acceso");
  const status = approve ? "approved" : "denied";
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(appAccess)
      .values({ email, status, decidedAt: now, decidedById: adminId })
      .onConflictDoUpdate({ target: appAccess.email, set: { status, decidedAt: now, decidedById: adminId } });
    if (!approve) {
      const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (target) await tx.delete(session).where(eq(session.userId, target.id));
    }
    // La solicitud ya está resuelta: deja de figurar como no leída en el buzón de los admins.
    await tx
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.type, "access_request"),
          sql`${notifications.data}->>'email' = ${email}`,
          sql`${notifications.readAt} is null`,
        ),
      );
    const admins = await tx.select({ id: user.id }).from(user).where(inArray(user.email, env.adminEmails));
    for (const admin of admins) await publish(tx, userChannel(admin.id), { type: "notification" });
  });
}
