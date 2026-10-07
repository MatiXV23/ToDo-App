import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Executor } from "@/server/db";
import { notifications, projectInvitations, projects, tasks, user } from "@/server/db/schema";
import { publish, userChannel } from "@/server/events";

export type NotificationType =
  | "invitation"
  | "invitation_accepted"
  | "assigned"
  | "comment"
  | "due_soon"
  | "removed_from_project"
  | "access_request";

export async function notify(
  ex: Executor,
  input: {
    userId: string;
    type: NotificationType;
    projectId?: string | null;
    taskId?: string | null;
    invitationId?: string | null;
    actorId?: string | null;
    data?: Record<string, unknown>;
  },
) {
  // Nadie recibe avisos de sus propias acciones.
  if (input.actorId && input.actorId === input.userId) return;
  await ex.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    invitationId: input.invitationId ?? null,
    actorId: input.actorId ?? null,
    data: input.data ?? {},
  });
  await publish(ex, userChannel(input.userId), { type: "notification" });
}

const actorUser = alias(user, "actor");

export async function listNotifications(userId: string, opts: { limit?: number } = {}) {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      project: { id: projects.id, key: projects.key, name: projects.name },
      task: { id: tasks.id, number: tasks.number, title: tasks.title, deletedAt: tasks.deletedAt },
      actor: { id: actorUser.id, name: actorUser.name, image: actorUser.image },
      invitation: {
        id: projectInvitations.id,
        status: projectInvitations.status,
        role: projectInvitations.role,
      },
    })
    .from(notifications)
    .leftJoin(projects, eq(projects.id, notifications.projectId))
    .leftJoin(tasks, eq(tasks.id, notifications.taskId))
    .leftJoin(actorUser, eq(actorUser.id, notifications.actorId))
    .leftJoin(projectInvitations, eq(projectInvitations.id, notifications.invitationId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 50);
}

export async function unreadCount(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markRead(userId: string, ids?: string[]) {
  const conditions = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (ids?.length) conditions.push(inArray(notifications.id, ids));
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...conditions));
    await publish(tx, userChannel(userId), { type: "notification" });
  });
}
