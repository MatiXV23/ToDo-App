import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { taskAttachments } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, actorUserId, authorize } from "@/server/permissions/access";
import { deleteStoredFile, detectImage, saveFile } from "@/server/storage";
import { logActivity } from "./activity";
import { requestReviewIfExternal } from "./review";
import { loadTask } from "./tasks";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PER_TASK = 40;

export async function addAttachment(actor: Actor, input: { taskId: string; fileName: string; data: Buffer }) {
  const task = await loadTask(db, input.taskId);
  await authorize(db, actor, task.projectId, "task.update");
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw badRequest("La imagen supera los 10 MB");
  const type = detectImage(input.data);
  if (!type) throw badRequest("Solo se aceptan imágenes PNG, JPG, GIF o WebP");
  const [{ n }] = await db.select({ n: count() }).from(taskAttachments).where(eq(taskAttachments.taskId, task.id));
  if (n >= MAX_PER_TASK) throw badRequest(`Máximo ${MAX_PER_TASK} adjuntos por tarea`);

  const storageKey = `${randomUUID()}.${type.ext}`;
  await saveFile(storageKey, input.data);
  try {
    return await db.transaction(async (tx) => {
      const fileName = input.fileName.replace(/[/\\]/g, "_").slice(0, 200) || `imagen.${type.ext}`;
      const [row] = await tx
        .insert(taskAttachments)
        .values({
          taskId: task.id,
          uploadedById: actorUserId(actor),
          fileName,
          contentType: type.contentType,
          sizeBytes: input.data.length,
          storageKey,
        })
        .returning();
      await logActivity(tx, actor, [
        { taskId: task.id, projectId: task.projectId, kind: "attached", field: "attachment", newValue: { id: row.id, label: fileName } },
      ]);
      await requestReviewIfExternal(tx, actor, [task.id]);
      await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
      await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
      return row;
    });
  } catch (err) {
    await deleteStoredFile(storageKey);
    throw err;
  }
}

async function loadAttachment(id: string) {
  const [row] = await db.select().from(taskAttachments).where(eq(taskAttachments.id, id));
  if (!row) throw notFound("Adjunto");
  return row;
}

/** Para descargar: verifica que el actor pueda ver el proyecto. */
export async function getAttachmentForDownload(actor: Actor, id: string) {
  const row = await loadAttachment(id);
  const task = await loadTask(db, row.taskId);
  await authorize(db, actor, task.projectId, "project.view");
  return row;
}

export async function deleteAttachment(actor: Actor, id: string) {
  const row = await loadAttachment(id);
  const task = await loadTask(db, row.taskId);
  await db.transaction(async (tx) => {
    await authorize(tx, actor, task.projectId, "task.update");
    await tx.delete(taskAttachments).where(eq(taskAttachments.id, id));
    await logActivity(tx, actor, [
      { taskId: task.id, projectId: task.projectId, kind: "detached", field: "attachment", oldValue: { id, label: row.fileName } },
    ]);
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
  });
  await deleteStoredFile(row.storageKey);
}
