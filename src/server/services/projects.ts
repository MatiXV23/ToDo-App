import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { boardColumns, projectMembers, projects, tasks } from "@/server/db/schema";
import { conflict, forbidden, notFound } from "@/server/errors";
import { projectChannel, publish, userChannel } from "@/server/events";
import { allowedActions } from "@/server/permissions";
import { type Actor, authorize, getRole } from "@/server/permissions/access";
import { DEFAULT_COLUMNS, PROJECT_KEY_RE } from "@/lib/domain";
import { ranksBetween } from "@/lib/rank";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PROJECT_KEY_RE, "La clave debe tener de 2 a 10 letras o números y empezar con letra"),
  description: z.string().max(2000).default(""),
  sprintsEnabled: z.boolean().default(false),
});

export const updateProjectSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  sprintsEnabled: z.boolean().optional(),
});

export async function createProject(actor: Actor, input: z.input<typeof createProjectSchema>) {
  if (actor.type !== "user") throw forbidden();
  const data = createProjectSchema.parse(input);
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ ...data, ownerId: actor.userId })
      .onConflictDoNothing({ target: projects.key })
      .returning();
    if (!project) throw conflict(`Ya existe un proyecto con la clave ${data.key}`);

    await tx.insert(projectMembers).values({ projectId: project.id, userId: actor.userId, role: "owner" });
    const ranks = ranksBetween(null, null, DEFAULT_COLUMNS.length);
    await tx.insert(boardColumns).values(
      DEFAULT_COLUMNS.map((c, i) => ({ projectId: project.id, name: c.name, category: c.category, rank: ranks[i] })),
    );
    await publish(tx, userChannel(actor.userId), { type: "projects" });
    return project;
  });
}

export async function listMyProjects(userId: string) {
  const openTasks = db
    .select({ projectId: tasks.projectId, n: count().as("n") })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), isNull(tasks.completedAt), isNull(tasks.parentId)))
    .groupBy(tasks.projectId)
    .as("open_tasks");

  return db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      description: projects.description,
      archivedAt: projects.archivedAt,
      role: projectMembers.role,
      openTasks: sql<number>`coalesce(${openTasks.n}, 0)`.mapWith(Number),
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .leftJoin(openTasks, eq(openTasks.projectId, projects.id))
    .where(eq(projectMembers.userId, userId))
    .orderBy(asc(projects.name));
}

export async function getProjectByKey(actor: Actor, key: string) {
  if (actor.type !== "user") throw forbidden();
  const [project] = await db.select().from(projects).where(eq(projects.key, key.toUpperCase()));
  if (!project) throw notFound("Proyecto");
  const role = await getRole(db, project.id, actor.userId);
  if (!role) throw notFound("Proyecto");
  return { ...project, role, can: allowedActions(role) };
}

export async function updateProject(actor: Actor, input: z.input<typeof updateProjectSchema>) {
  const { projectId, ...patch } = updateProjectSchema.parse(input);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, projectId, "project.update");
    const [project] = await tx.update(projects).set(patch).where(eq(projects.id, projectId)).returning();
    await publish(tx, projectChannel(projectId), { type: "project" }, actor);
    await publish(tx, projectChannel(projectId), { type: "board" }, actor);
    return project;
  });
}

export async function setArchived(actor: Actor, projectId: string, archived: boolean) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor, projectId, "project.archive");
    await tx
      .update(projects)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(projects.id, projectId));
    await notifyAllMembers(tx, projectId);
  });
}

export async function deleteProject(actor: Actor, projectId: string, confirmKey: string) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor, projectId, "project.delete");
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project || project.key !== confirmKey.trim().toUpperCase()) {
      throw conflict("La clave de confirmación no coincide");
    }
    await notifyAllMembers(tx, projectId);
    // Las tareas referencian columnas sin cascade: se borran primero.
    await tx.delete(tasks).where(eq(tasks.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

async function notifyAllMembers(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string) {
  const members = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  for (const m of members) await publish(tx, userChannel(m.userId), { type: "projects" });
}

