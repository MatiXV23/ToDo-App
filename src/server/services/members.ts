import { and, asc, eq, inArray } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import {
  notifications,
  projectInvitations,
  projectMembers,
  projects,
  tasks,
  user,
} from "@/server/db/schema";
import { conflict, forbidden, notFound, badRequest } from "@/server/errors";
import { projectChannel, publish, userChannel } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";
import { can } from "@/server/permissions";
import { notify } from "./notifications";

export const inviteSchema = z.object({
  projectId: z.uuid(),
  email: z.email("Email inválido").transform((e) => e.trim().toLowerCase()),
  role: z.enum(["editor", "viewer"]),
});

function requireUser(actor: Actor) {
  if (actor.type !== "user") throw forbidden();
  return actor;
}

export async function listMembers(actor: Actor, projectId: string) {
  const role = await authorize(db, actor, projectId, "project.view");
  const members = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: projectMembers.role,
      joinedAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.name));

  const invitations = can(role, "member.manage")
    ? await db
        .select({
          id: projectInvitations.id,
          email: projectInvitations.email,
          role: projectInvitations.role,
          createdAt: projectInvitations.createdAt,
        })
        .from(projectInvitations)
        .where(
          and(eq(projectInvitations.projectId, projectId), eq(projectInvitations.status, "pending")),
        )
        .orderBy(asc(projectInvitations.createdAt))
    : [];

  return { members, invitations };
}

export async function inviteMember(actor: Actor, input: z.input<typeof inviteSchema>) {
  const { projectId, email, role } = inviteSchema.parse(input);
  const me = requireUser(actor);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, projectId, "member.manage");

    const [existingUser] = await tx.select().from(user).where(eq(user.email, email)).limit(1);
    if (existingUser) {
      const [member] = await tx
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, existingUser.id)));
      if (member) throw conflict("Esa persona ya es miembro del proyecto");
    }

    const [invitation] = await tx
      .insert(projectInvitations)
      .values({ projectId, email, role, invitedById: me.userId })
      .onConflictDoNothing()
      .returning();
    if (!invitation) throw conflict("Ya hay una invitación pendiente para ese email");

    if (existingUser) {
      await notify(tx, {
        userId: existingUser.id,
        type: "invitation",
        projectId,
        invitationId: invitation.id,
        actorId: me.userId,
      });
    }
    await publish(tx, projectChannel(projectId), { type: "project" }, actor);
    return invitation;
  });
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId));
    if (!inv) throw notFound("Invitación");
    await authorize(tx, actor, inv.projectId, "member.manage");
    if (inv.status !== "pending") throw conflict("La invitación ya no está pendiente");
    await tx
      .update(projectInvitations)
      .set({ status: "revoked", respondedAt: new Date() })
      .where(eq(projectInvitations.id, invitationId));
    const [invitee] = await tx.select({ id: user.id }).from(user).where(eq(user.email, inv.email));
    if (invitee) await publish(tx, userChannel(invitee.id), { type: "notification" });
    await publish(tx, projectChannel(inv.projectId), { type: "project" }, actor);
  });
}

/** Invitaciones pendientes para el email del usuario. */
export async function listMyInvitations(userId: string) {
  const [me] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (!me) return [];
  return db
    .select({
      id: projectInvitations.id,
      role: projectInvitations.role,
      createdAt: projectInvitations.createdAt,
      project: { id: projects.id, key: projects.key, name: projects.name },
      invitedBy: { name: user.name, image: user.image },
    })
    .from(projectInvitations)
    .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
    .innerJoin(user, eq(user.id, projectInvitations.invitedById))
    .where(
      and(eq(projectInvitations.email, me.email.toLowerCase()), eq(projectInvitations.status, "pending")),
    );
}

export async function respondInvitation(actor: Actor, invitationId: string, accept: boolean) {
  const me = requireUser(actor);
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
      .for("update");
    const [current] = await tx.select().from(user).where(eq(user.id, me.userId));
    // Solo quien tiene el email invitado puede verla o responderla.
    if (!inv || !current || inv.email !== current.email.toLowerCase()) throw notFound("Invitación");
    if (inv.status !== "pending") throw conflict("La invitación ya no está pendiente");

    await tx
      .update(projectInvitations)
      .set({ status: accept ? "accepted" : "declined", respondedAt: new Date() })
      .where(eq(projectInvitations.id, invitationId));

    if (accept) {
      await tx
        .insert(projectMembers)
        .values({ projectId: inv.projectId, userId: me.userId, role: inv.role })
        .onConflictDoNothing();
      await notify(tx, {
        userId: inv.invitedById,
        type: "invitation_accepted",
        projectId: inv.projectId,
        actorId: me.userId,
      });
      await publish(tx, projectChannel(inv.projectId), { type: "project" }, actor);
    }

    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.invitationId, invitationId), eq(notifications.userId, me.userId)));
    await publish(tx, userChannel(me.userId), { type: "projects" });
    await publish(tx, userChannel(me.userId), { type: "notification" });

    const [project] = await tx
      .select({ key: projects.key })
      .from(projects)
      .where(eq(projects.id, inv.projectId));
    return { projectKey: project?.key ?? null };
  });
}

export async function changeRole(
  actor: Actor,
  input: { projectId: string; userId: string; role: "editor" | "viewer" },
) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor, input.projectId, "member.manage");
    const [target] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)));
    if (!target) throw notFound("Miembro");
    if (target.role === "owner") throw badRequest("No se puede cambiar el rol del dueño");
    await tx
      .update(projectMembers)
      .set({ role: input.role })
      .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)));
    await publish(tx, projectChannel(input.projectId), { type: "project" }, actor);
    await publish(tx, userChannel(input.userId), { type: "projects" });
  });
}

/** El dueño puede quitar a cualquiera menos a sí mismo; cualquier otro miembro puede salir. */
export async function removeMember(actor: Actor, input: { projectId: string; userId: string }) {
  const me = requireUser(actor);
  return db.transaction(async (tx) => {
    const leaving = input.userId === me.userId;
    if (leaving) await authorize(tx, actor, input.projectId, "project.view");
    else await authorize(tx, actor, input.projectId, "member.manage");

    const [target] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)));
    if (!target) throw notFound("Miembro");
    if (target.role === "owner") throw badRequest("El dueño no puede salir del proyecto");

    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)));
    // Sus tareas quedan sin responsable: ya no puede verlas.
    await tx
      .update(tasks)
      .set({ assigneeId: null })
      .where(and(eq(tasks.projectId, input.projectId), eq(tasks.assigneeId, input.userId)));
    if (!leaving) {
      await notify(tx, {
        userId: input.userId,
        type: "removed_from_project",
        actorId: me.userId,
        data: { projectId: input.projectId },
      });
    }
    await publish(tx, projectChannel(input.projectId), { type: "project" }, actor);
    await publish(tx, projectChannel(input.projectId), { type: "board" }, actor);
    await publish(tx, userChannel(input.userId), { type: "projects" });
  });
}

/** Al crearse un usuario, sus invitaciones pendientes aparecen en el buzón. */
export async function onUserCreated(created: { id: string; email: string }) {
  const pending = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.email, created.email.toLowerCase()),
        eq(projectInvitations.status, "pending"),
      ),
    );
  if (pending.length === 0) return;
  await db.transaction(async (tx) => {
    for (const inv of pending) {
      await notify(tx, {
        userId: created.id,
        type: "invitation",
        projectId: inv.projectId,
        invitationId: inv.id,
        actorId: inv.invitedById,
      });
    }
  });
}

/** Ids de miembros del proyecto entre los dados (para validar responsables). */
export async function memberIds(projectId: string, userIds: string[]) {
  if (userIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds)));
  return new Set(rows.map((r) => r.userId));
}

