import { asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { boardColumnTags, tags, taskTags } from "@/server/db/schema";
import type { Actor } from "@/server/permissions/access";
import { type ActivityEntry, logActivity } from "./activity";

/**
 * Tags automáticos de columna: las tareas que se crean en la columna o entran a ella los
 * reciben. Sirve, por ejemplo, para una columna "IA" que marque las tareas para el agente.
 * Al salir de la columna los tags quedan: quitarlos es decisión de quien edita la tarea.
 */

export async function columnTagIds(ex: Executor, columnId: string) {
  const rows = await ex
    .select({ tagId: boardColumnTags.tagId })
    .from(boardColumnTags)
    .where(eq(boardColumnTags.columnId, columnId));
  return rows.map((r) => r.tagId);
}

/**
 * Agrega a las tareas los tags de la columna (o los indicados) que todavía no tengan,
 * dejando constancia en el historial. Devuelve los ids de las tareas que cambiaron.
 */
export async function applyColumnTags(
  ex: Executor,
  actor: Actor,
  column: { id: string; projectId: string },
  taskIds: string[],
  onlyTagIds?: string[],
) {
  const tagIds = onlyTagIds ?? (await columnTagIds(ex, column.id));
  if (taskIds.length === 0 || tagIds.length === 0) return [];

  // En serie: dentro de una transacción todas las queries comparten la misma conexión.
  const wanted = await ex.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, tagIds));
  const current = await ex
    .select({ taskId: taskTags.taskId, tagId: taskTags.tagId, name: tags.name })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, taskIds))
    .orderBy(asc(tags.name));

  const inserts: { taskId: string; tagId: string }[] = [];
  const activity: ActivityEntry[] = [];
  for (const taskId of taskIds) {
    const has = current.filter((c) => c.taskId === taskId);
    const missing = wanted.filter((t) => !has.some((h) => h.tagId === t.id));
    if (missing.length === 0) continue;
    inserts.push(...missing.map((t) => ({ taskId, tagId: t.id })));
    activity.push({
      taskId,
      projectId: column.projectId,
      kind: "updated",
      field: "tags",
      oldValue: has.map((h) => h.name),
      newValue: [...has.map((h) => h.name), ...missing.map((t) => t.name)],
    });
  }
  if (inserts.length) await ex.insert(taskTags).values(inserts).onConflictDoNothing();
  await logActivity(ex, actor, activity);
  return activity.map((a) => a.taskId);
}
