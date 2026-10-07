import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { sprints, tasks } from "@/server/db/schema";
import { badRequest, conflict, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";

/**
 * Referencia calificada a tasks.id para subconsultas correlacionadas: Drizzle escribe
 * `${tasks.id}` como "id" a secas, que dentro de la subconsulta apuntaría a su propia tabla.
 */
const OUTER_TASK_ID = sql.raw('"tasks"."id"');
import { rankBetween } from "@/lib/rank";
import { logActivity } from "./activity";
import { loadTask } from "./tasks";

const dateOrNull = z.iso.date().nullable();

export const createSprintSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().max(80).optional(),
  goal: z.string().max(1000).default(""),
  startDate: dateOrNull.optional(),
  endDate: dateOrNull.optional(),
});

export const updateSprintSchema = z.object({
  sprintId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  goal: z.string().max(1000).optional(),
  startDate: dateOrNull.optional(),
  endDate: dateOrNull.optional(),
});

export const completeSprintSchema = z.object({
  sprintId: z.uuid(),
  /** Adónde van las tareas sin terminar: al backlog (null) o a otro sprint. */
  moveOpenTasksTo: z.uuid().nullable(),
});

export const moveInBacklogSchema = z.object({
  taskId: z.uuid(),
  sprintId: z.uuid().nullable(),
  afterTaskId: z.uuid().nullable(),
});

async function loadSprint(sprintId: string) {
  const [sprint] = await db.select().from(sprints).where(eq(sprints.id, sprintId));
  if (!sprint) throw notFound("Sprint");
  return sprint;
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createSprint(actor: Actor, input: z.input<typeof createSprintSchema>) {
  const data = createSprintSchema.parse(input);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, data.projectId, "sprint.manage");
    const [{ n }] = await tx
      .select({ n: count() })
      .from(sprints)
      .where(eq(sprints.projectId, data.projectId));
    const [sprint] = await tx
      .insert(sprints)
      .values({ ...data, name: data.name || `Sprint ${n + 1}` })
      .returning();
    await publish(tx, projectChannel(data.projectId), { type: "board" }, actor);
    return sprint;
  });
}

export async function updateSprint(actor: Actor, input: z.input<typeof updateSprintSchema>) {
  const { sprintId, ...patch } = updateSprintSchema.parse(input);
  const sprint = await loadSprint(sprintId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, sprint.projectId, "sprint.manage");
    const [updated] = await tx.update(sprints).set(patch).where(eq(sprints.id, sprintId)).returning();
    await publish(tx, projectChannel(sprint.projectId), { type: "board" }, actor);
    return updated;
  });
}

export async function startSprint(
  actor: Actor,
  input: { sprintId: string; startDate?: string | null; endDate?: string | null },
) {
  const sprint = await loadSprint(input.sprintId);
  if (sprint.status !== "planned") throw badRequest("Solo se puede iniciar un sprint planificado");
  try {
    return await db.transaction(async (tx) => {
      await authorize(tx, actor, sprint.projectId, "sprint.manage");
      const [updated] = await tx
        .update(sprints)
        .set({
          status: "active",
          startedAt: new Date(),
          startDate: input.startDate ?? sprint.startDate ?? new Date().toISOString().slice(0, 10),
          endDate: input.endDate ?? sprint.endDate,
        })
        .where(eq(sprints.id, sprint.id))
        .returning();
      await publish(tx, projectChannel(sprint.projectId), { type: "board" }, actor);
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya hay un sprint activo. Cerralo antes de iniciar otro.");
    throw err;
  }
}

export async function completeSprint(actor: Actor, input: z.input<typeof completeSprintSchema>) {
  const { sprintId, moveOpenTasksTo } = completeSprintSchema.parse(input);
  const sprint = await loadSprint(sprintId);
  if (sprint.status !== "active") throw badRequest("Solo se puede cerrar el sprint activo");
  return db.transaction(async (tx) => {
    await authorize(tx, actor, sprint.projectId, "sprint.manage");
    if (moveOpenTasksTo) {
      const [target] = await tx
        .select()
        .from(sprints)
        .where(and(eq(sprints.id, moveOpenTasksTo), eq(sprints.projectId, sprint.projectId)));
      if (!target || target.status !== "planned") throw badRequest("El sprint destino tiene que estar planificado");
    }
    const moved = await tx
      .update(tasks)
      .set({ sprintId: moveOpenTasksTo })
      .where(and(eq(tasks.sprintId, sprint.id), isNull(tasks.completedAt), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    await tx
      .update(sprints)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(sprints.id, sprint.id));
    await publish(tx, projectChannel(sprint.projectId), { type: "board" }, actor);
    return { movedTasks: moved.length };
  });
}

/** Solo se pueden borrar sprints planificados; sus tareas vuelven al backlog. */
export async function deleteSprint(actor: Actor, sprintId: string) {
  const sprint = await loadSprint(sprintId);
  if (sprint.status !== "planned") throw badRequest("Solo se pueden borrar sprints planificados");
  await db.transaction(async (tx) => {
    await authorize(tx, actor, sprint.projectId, "sprint.manage");
    await tx.update(tasks).set({ sprintId: null }).where(eq(tasks.sprintId, sprintId));
    await tx.delete(sprints).where(eq(sprints.id, sprintId));
    await publish(tx, projectChannel(sprint.projectId), { type: "board" }, actor);
  });
}

const backlogTaskFields = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
  priority: tasks.priority,
  assigneeId: tasks.assigneeId,
  epicId: tasks.epicId,
  columnId: tasks.columnId,
  sprintId: tasks.sprintId,
  backlogRank: tasks.backlogRank,
  estimateHours: tasks.estimateHours,
  dueDate: tasks.dueDate,
  completedAt: tasks.completedAt,
  tagIds: sql<string[]>`coalesce((select array_agg(tt.tag_id) from task_tags tt where tt.task_id = ${OUTER_TASK_ID}), '{}')`,
  subtaskCount: sql<number>`(select count(*) from tasks st where st.parent_id = ${OUTER_TASK_ID} and st.deleted_at is null)`.mapWith(Number),
};

/**
 * Backlog: sprints abiertos con sus tareas y las tareas sin sprint.
 * Solo tareas principales; las terminadas sin sprint no aparecen.
 */
export async function getBacklog(actor: Actor, projectId: string) {
  await authorize(db, actor, projectId, "project.view");
  const openSprints = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), ne(sprints.status, "completed")))
    .orderBy(desc(sql`${sprints.status} = 'active'`), asc(sprints.createdAt));
  const sprintIds = openSprints.map((s) => s.id);
  const rows = await db
    .select(backlogTaskFields)
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.deletedAt),
        isNull(tasks.parentId),
        or(
          and(isNull(tasks.sprintId), isNull(tasks.completedAt)),
          sprintIds.length ? inArray(tasks.sprintId, sprintIds) : sql`false`,
        ),
      ),
    )
    .orderBy(asc(tasks.backlogRank));
  return { sprints: openSprints, tasks: rows };
}

export async function moveInBacklog(actor: Actor, input: z.input<typeof moveInBacklogSchema>) {
  const { taskId, sprintId, afterTaskId } = moveInBacklogSchema.parse(input);
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, taskId, true);
    await authorize(tx, actor, task.projectId, "sprint.manage");
    if (task.parentId) throw badRequest("Las subtareas siguen a su tarea principal");
    let targetSprint: typeof sprints.$inferSelect | null = null;
    if (sprintId) {
      [targetSprint] = await tx
        .select()
        .from(sprints)
        .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, task.projectId)));
      if (!targetSprint || targetSprint.status === "completed") throw badRequest("Sprint inválido");
    }

    const scope = and(
      eq(tasks.projectId, task.projectId),
      isNull(tasks.deletedAt),
      isNull(tasks.parentId),
      ne(tasks.id, task.id),
      sprintId ? eq(tasks.sprintId, sprintId) : isNull(tasks.sprintId),
    );
    let prev: string | null = null;
    if (afterTaskId) {
      const [after] = await tx.select({ rank: tasks.backlogRank }).from(tasks).where(and(scope, eq(tasks.id, afterTaskId)));
      prev = after?.rank ?? null;
    }
    const [nextRow] = await tx
      .select({ rank: tasks.backlogRank })
      .from(tasks)
      .where(prev ? and(scope, gt(tasks.backlogRank, prev)) : scope)
      .orderBy(asc(tasks.backlogRank))
      .limit(1);
    const backlogRank = rankBetween(prev, nextRow?.rank ?? null);

    await tx.update(tasks).set({ backlogRank, sprintId }).where(eq(tasks.id, task.id));
    if (sprintId !== task.sprintId) {
      await tx
        .update(tasks)
        .set({ sprintId })
        .where(and(eq(tasks.parentId, task.id), isNull(tasks.deletedAt)));
      const [previous] = task.sprintId
        ? await tx.select({ id: sprints.id, label: sprints.name }).from(sprints).where(eq(sprints.id, task.sprintId))
        : [null];
      await logActivity(tx, actor, [
        {
          taskId: task.id,
          projectId: task.projectId,
          kind: "updated",
          field: "sprint",
          oldValue: previous ?? null,
          newValue: targetSprint ? { id: targetSprint.id, label: targetSprint.name } : null,
        },
      ]);
    }
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
  });
}

/** Datos de un sprint para resúmenes. */
export async function getSprintStats(actor: Actor, sprintId: string) {
  const sprint = await loadSprint(sprintId);
  await authorize(db, actor, sprint.projectId, "project.view");
  const rows = await db
    .select(backlogTaskFields)
    .from(tasks)
    .where(and(eq(tasks.sprintId, sprintId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.backlogRank));
  return { sprint, tasks: rows };
}
