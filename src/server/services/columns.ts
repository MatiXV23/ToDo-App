import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import * as z from "zod";
import { db, type Executor } from "@/server/db";
import { boardColumns, boardColumnTags, tags, tasks } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";
import { COLUMN_CATEGORIES } from "@/lib/domain";
import { rankBetween } from "@/lib/rank";
import { applyColumnTags, columnTagIds } from "./column-tags";

const name = z.string().trim().min(1, "Poné un nombre").max(40);
/** Tags que reciben solas las tareas que se crean en la columna o entran a ella. */
const autoTagIds = z.array(z.uuid()).max(10);

export const createColumnSchema = z.object({
  projectId: z.uuid(),
  name,
  category: z.enum(COLUMN_CATEGORIES),
  autoTagIds: autoTagIds.optional(),
});

export const updateColumnSchema = z.object({
  columnId: z.uuid(),
  name: name.optional(),
  category: z.enum(COLUMN_CATEGORIES).optional(),
  autoTagIds: autoTagIds.optional(),
});

async function assertProjectTags(ex: Executor, projectId: string, tagIds: string[]) {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return unique;
  const rows = await ex
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.projectId, projectId), inArray(tags.id, unique)));
  if (rows.length !== unique.length) throw badRequest("Tag inválido");
  return unique;
}

/** Reemplaza los tags automáticos y se los agrega a las tareas que ya están en la columna. */
async function setAutoTags(tx: Executor, actor: Actor, column: { id: string; projectId: string }, tagIds: string[]) {
  const next = await assertProjectTags(tx, column.projectId, tagIds);
  // Serializa cambios simultáneos sobre la misma columna (borrar + insertar chocaría).
  await tx.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.id, column.id)).for("update");
  const previous = await columnTagIds(tx, column.id);
  await tx.delete(boardColumnTags).where(eq(boardColumnTags.columnId, column.id));
  if (next.length) {
    await tx
      .insert(boardColumnTags)
      .values(next.map((tagId) => ({ columnId: column.id, tagId })))
      .onConflictDoNothing();
  }
  const added = next.filter((id) => !previous.includes(id));
  if (added.length === 0) return [];
  const inColumn = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.columnId, column.id), isNull(tasks.deletedAt)));
  return applyColumnTags(
    tx,
    actor,
    column,
    inColumn.map((t) => t.id),
    added,
  );
}

async function loadColumn(columnId: string) {
  const [column] = await db.select().from(boardColumns).where(eq(boardColumns.id, columnId));
  if (!column) throw notFound("Columna");
  return column;
}

export async function createColumn(actor: Actor, input: z.input<typeof createColumnSchema>) {
  const { autoTagIds, ...data } = createColumnSchema.parse(input);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, data.projectId, "column.manage");
    const [last] = await tx
      .select({ rank: boardColumns.rank })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, data.projectId))
      .orderBy(desc(boardColumns.rank))
      .limit(1);
    const [column] = await tx
      .insert(boardColumns)
      .values({ ...data, rank: rankBetween(last?.rank ?? null, null) })
      .returning();
    if (autoTagIds?.length) await setAutoTags(tx, actor, column, autoTagIds);
    await publish(tx, projectChannel(data.projectId), { type: "board" }, actor);
    return column;
  });
}

export async function updateColumn(actor: Actor, input: z.input<typeof updateColumnSchema>) {
  const { columnId, autoTagIds, ...patch } = updateColumnSchema.parse(input);
  const column = await loadColumn(columnId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, column.projectId, "column.manage");
    const [updated] = Object.keys(patch).length
      ? await tx.update(boardColumns).set(patch).where(eq(boardColumns.id, columnId)).returning()
      : [column];
    const tagged = autoTagIds ? await setAutoTags(tx, actor, column, autoTagIds) : [];
    await publish(tx, projectChannel(column.projectId), { type: "board" }, actor);
    for (const taskId of tagged) await publish(tx, projectChannel(column.projectId), { type: "task", taskId }, actor);
    return updated;
  });
}

export async function moveColumn(actor: Actor, input: { columnId: string; afterColumnId: string | null }) {
  const column = await loadColumn(input.columnId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, column.projectId, "column.manage");
    const siblings = (
      await tx
        .select()
        .from(boardColumns)
        .where(eq(boardColumns.projectId, column.projectId))
        .orderBy(asc(boardColumns.rank))
    ).filter((c) => c.id !== column.id);
    const index = input.afterColumnId ? siblings.findIndex((c) => c.id === input.afterColumnId) : -1;
    if (input.afterColumnId && index === -1) throw badRequest("Columna de referencia inválida");
    const prev = index >= 0 ? siblings[index].rank : null;
    const next = siblings[index + 1]?.rank ?? null;
    await tx
      .update(boardColumns)
      .set({ rank: rankBetween(prev, next) })
      .where(eq(boardColumns.id, column.id));
    await publish(tx, projectChannel(column.projectId), { type: "board" }, actor);
  });
}

/** Borra una columna moviendo sus tareas a otra. */
export async function deleteColumn(actor: Actor, input: { columnId: string; moveTasksTo: string }) {
  const column = await loadColumn(input.columnId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, column.projectId, "column.manage");
    const [{ n }] = await tx
      .select({ n: count() })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, column.projectId));
    if (n <= 1) throw badRequest("El tablero necesita al menos una columna");
    if (input.moveTasksTo === column.id) throw badRequest("Elegí otra columna destino");
    const [target] = await tx
      .select()
      .from(boardColumns)
      .where(and(eq(boardColumns.id, input.moveTasksTo), eq(boardColumns.projectId, column.projectId)));
    if (!target) throw badRequest("Columna destino inválida");

    // Se agregan al final de la columna destino conservando su orden relativo.
    const [bottom] = await tx
      .select({ rank: tasks.rank })
      .from(tasks)
      .where(eq(tasks.columnId, target.id))
      .orderBy(desc(tasks.rank))
      .limit(1);
    const moving = await tx
      .select({ id: tasks.id, completedAt: tasks.completedAt })
      .from(tasks)
      .where(eq(tasks.columnId, column.id))
      .orderBy(asc(tasks.rank));
    let prev = bottom?.rank ?? null;
    for (const t of moving) {
      const rank = rankBetween(prev, null);
      await tx
        .update(tasks)
        .set({
          columnId: target.id,
          rank,
          completedAt: target.category === "done" ? (t.completedAt ?? new Date()) : null,
        })
        .where(eq(tasks.id, t.id));
      prev = rank;
    }
    await applyColumnTags(
      tx,
      actor,
      target,
      moving.map((t) => t.id),
    );
    await tx.delete(boardColumns).where(eq(boardColumns.id, column.id));
    await publish(tx, projectChannel(column.projectId), { type: "board" }, actor);
  });
}
