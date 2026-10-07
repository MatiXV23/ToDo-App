import { eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { comments } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { can } from "@/server/permissions";
import { type Actor, actorUserId, authorize } from "@/server/permissions/access";
import { notify } from "./notifications";
import { isExternalActor, requestReviewIfExternal } from "./review";
import { loadTask } from "./tasks";

export const addCommentSchema = z.object({
  taskId: z.uuid(),
  bodyMd: z.string().trim().min(1, "El comentario está vacío").max(20_000),
});

export async function addComment(actor: Actor, input: z.input<typeof addCommentSchema>) {
  const { taskId, bodyMd } = addCommentSchema.parse(input);
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, taskId);
    await authorize(tx, actor, task.projectId, "comment.create");
    const [comment] = await tx
      .insert(comments)
      .values({
        taskId,
        bodyMd,
        authorId: actorUserId(actor),
        source: actor.type === "automation" ? "automation" : actor.type === "user" ? "user" : "system",
        automationRuleId: actor.type === "automation" ? actor.ruleId : null,
        via: actor.type === "user" ? (actor.via ?? null) : null,
      })
      .returning();
    await requestReviewIfExternal(tx, actor, [taskId]);

    // Solo los comentarios de personas generan avisos; los automáticos serían ruido.
    const recipients =
      actor.type === "user" ? new Set([task.assigneeId, task.reporterId].filter((id): id is string => !!id)) : new Set<string>();
    for (const userId of recipients) {
      await notify(tx, {
        userId,
        type: "comment",
        projectId: task.projectId,
        taskId,
        actorId: actorUserId(actor),
        data: { excerpt: bodyMd.slice(0, 140) },
      });
    }
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [taskId] }, actor);
    return comment;
  });
}

async function loadOwnComment(actor: Actor, commentId: string, moderateAllowed: boolean) {
  const [comment] = await db.select().from(comments).where(eq(comments.id, commentId));
  if (!comment) throw notFound("Comentario");
  const task = await loadTask(db, comment.taskId);
  const role = await authorize(db, actor, task.projectId, "project.view");
  const isAuthor = actor.type === "user" && comment.authorId === actor.userId;
  if (!isAuthor && !(moderateAllowed && can(role, "comment.moderate"))) throw forbidden();
  if (isAuthor && !can(role, "comment.create")) throw forbidden();
  return { comment, task };
}

export async function updateComment(actor: Actor, input: { commentId: string; bodyMd: string }) {
  const bodyMd = addCommentSchema.shape.bodyMd.parse(input.bodyMd);
  const { task } = await loadOwnComment(actor, input.commentId, false);
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(comments)
      .set({ bodyMd, editedAt: new Date() })
      .where(eq(comments.id, input.commentId))
      .returning();
    await requestReviewIfExternal(tx, actor, [task.id]);
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    if (isExternalActor(actor)) await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    return updated;
  });
}

export async function deleteComment(actor: Actor, commentId: string) {
  const { task } = await loadOwnComment(actor, commentId, true);
  await db.transaction(async (tx) => {
    await tx.delete(comments).where(eq(comments.id, commentId));
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
  });
}
