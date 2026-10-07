import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { epics, tasks } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";
import { PALETTE } from "@/lib/domain";
import { rankBetween } from "@/lib/rank";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");

export const createEpicSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "Poné un título").max(200),
  descriptionMd: z.string().max(50_000).default(""),
  color: color.optional(),
});

export const updateEpicSchema = z.object({
  epicId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  descriptionMd: z.string().max(50_000).optional(),
  color: color.optional(),
  status: z.enum(["open", "done"]).optional(),
});

async function loadEpic(epicId: string) {
  const [epic] = await db
    .select()
    .from(epics)
    .where(and(eq(epics.id, epicId), isNull(epics.deletedAt)));
  if (!epic) throw notFound("Epic");
  return epic;
}

export async function listEpics(actor: Actor, projectId: string) {
  await authorize(db, actor, projectId, "project.view");
  const stats = db
    .select({
      epicId: tasks.epicId,
      total: count().as("total"),
      done: sql<number>`count(${tasks.completedAt})`.as("done"),
      hours: sql<number>`coalesce(sum(${tasks.estimateHours}), 0)`.as("hours"),
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), isNull(tasks.parentId)))
    .groupBy(tasks.epicId)
    .as("stats");
  return db
    .select({
      id: epics.id,
      title: epics.title,
      descriptionMd: epics.descriptionMd,
      color: epics.color,
      status: epics.status,
      createdAt: epics.createdAt,
      total: sql<number>`coalesce(${stats.total}, 0)`.mapWith(Number),
      done: sql<number>`coalesce(${stats.done}, 0)`.mapWith(Number),
      hours: sql<number>`coalesce(${stats.hours}, 0)`.mapWith(Number),
    })
    .from(epics)
    .leftJoin(stats, eq(stats.epicId, epics.id))
    .where(and(eq(epics.projectId, projectId), isNull(epics.deletedAt)))
    .orderBy(asc(epics.rank));
}

export async function createEpic(actor: Actor, input: z.input<typeof createEpicSchema>) {
  const data = createEpicSchema.parse(input);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, data.projectId, "epic.manage");
    const existing = await tx
      .select({ rank: epics.rank })
      .from(epics)
      .where(eq(epics.projectId, data.projectId))
      .orderBy(desc(epics.rank));
    const [epic] = await tx
      .insert(epics)
      .values({
        ...data,
        color: data.color ?? PALETTE[(existing.length * 5 + 7) % PALETTE.length],
        rank: rankBetween(existing[0]?.rank ?? null, null),
      })
      .returning();
    await publish(tx, projectChannel(data.projectId), { type: "board" }, actor);
    return epic;
  });
}

export async function updateEpic(actor: Actor, input: z.input<typeof updateEpicSchema>) {
  const { epicId, ...patch } = updateEpicSchema.parse(input);
  const epic = await loadEpic(epicId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, epic.projectId, "epic.manage");
    const [updated] = await tx.update(epics).set(patch).where(eq(epics.id, epicId)).returning();
    await publish(tx, projectChannel(epic.projectId), { type: "board" }, actor);
    return updated;
  });
}

export async function deleteEpic(actor: Actor, epicId: string) {
  const epic = await loadEpic(epicId);
  await db.transaction(async (tx) => {
    await authorize(tx, actor, epic.projectId, "epic.manage");
    await tx.update(epics).set({ deletedAt: new Date() }).where(eq(epics.id, epicId));
    await tx.update(tasks).set({ epicId: null }).where(eq(tasks.epicId, epicId));
    await publish(tx, projectChannel(epic.projectId), { type: "board" }, actor);
  });
}

export async function getEpic(actor: Actor, epicId: string) {
  const epic = await loadEpic(epicId);
  await authorize(db, actor, epic.projectId, "project.view");
  const epicTasks = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      priority: tasks.priority,
      columnId: tasks.columnId,
      assigneeId: tasks.assigneeId,
      completedAt: tasks.completedAt,
      estimateHours: tasks.estimateHours,
    })
    .from(tasks)
    .where(and(eq(tasks.epicId, epicId), isNull(tasks.deletedAt), isNull(tasks.parentId)))
    .orderBy(asc(tasks.backlogRank));
  return { ...epic, tasks: epicTasks };
}
