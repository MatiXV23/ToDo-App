import { and, asc, count, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { boardColumns, tasks } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";
import { COLUMN_CATEGORIES } from "@/lib/domain";
import { rankBetween } from "@/lib/rank";

const name = z.string().trim().min(1, "Poné un nombre").max(40);

export const createColumnSchema = z.object({
  projectId: z.uuid(),
  name,
  category: z.enum(COLUMN_CATEGORIES),
});

export const updateColumnSchema = z.object({
  columnId: z.uuid(),
  name: name.optional(),
  category: z.enum(COLUMN_CATEGORIES).optional(),
});

async function loadColumn(columnId: string) {
  const [column] = await db.select().from(boardColumns).where(eq(boardColumns.id, columnId));
  if (!column) throw notFound("Columna");
  return column;
}

export async function createColumn(actor: Actor, input: z.input<typeof createColumnSchema>) {
  const data = createColumnSchema.parse(input);
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
    await publish(tx, projectChannel(data.projectId), { type: "board" }, actor);
    return column;
  });
}

export async function updateColumn(actor: Actor, input: z.input<typeof updateColumnSchema>) {
  const { columnId, ...patch } = updateColumnSchema.parse(input);
  const column = await loadColumn(columnId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, column.projectId, "column.manage");
    const [updated] = await tx.update(boardColumns).set(patch).where(eq(boardColumns.id, columnId)).returning();
    await publish(tx, projectChannel(column.projectId), { type: "board" }, actor);
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
    await tx.delete(boardColumns).where(eq(boardColumns.id, column.id));
    await publish(tx, projectChannel(column.projectId), { type: "board" }, actor);
  });
}
