import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import * as z from "zod";
import { db, type Executor, type Tx } from "@/server/db";
import {
  automationRules,
  boardColumns,
  comments,
  epics,
  projectMembers,
  projectRepositories,
  projects,
  sprints,
  tags,
  taskActivity,
  taskAttachments,
  taskTags,
  tasks,
  taskVcsLinks,
  user,
} from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { emitDomainEvent, projectChannel, publish } from "@/server/events";
import { type Actor, actorUserId, authorize } from "@/server/permissions/access";
import { PRIORITIES, taskKey } from "@/lib/domain";
import { rankBetween } from "@/lib/rank";
import { type ActivityEntry, logActivity } from "./activity";
import { applyColumnTags, columnTagIds } from "./column-tags";
import { notify } from "./notifications";

// ─── Esquemas ───────────────────────────────────────────────────────────

export const taskFieldsSchema = z.object({
  title: z.string().trim().min(1, "El título no puede estar vacío").max(300),
  descriptionMd: z.string().max(50_000),
  priority: z.enum(PRIORITIES),
  assigneeId: z.string().min(1).nullable(),
  epicId: z.uuid().nullable(),
  sprintId: z.uuid().nullable(),
  dueDate: z.iso.date().nullable(),
  estimateHours: z.number().min(0).max(9999).nullable(),
  tagIds: z.array(z.uuid()).max(30),
});

export const createTaskSchema = taskFieldsSchema.partial().extend({
  projectId: z.uuid(),
  title: taskFieldsSchema.shape.title,
  columnId: z.uuid().optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.enum(["top", "bottom"]).default("bottom"),
});

export const updateTaskSchema = taskFieldsSchema.partial().extend({
  taskId: z.uuid(),
  columnId: z.uuid().optional(),
});

export const moveTaskSchema = z.object({
  taskId: z.uuid(),
  columnId: z.uuid(),
  /** Tarea que queda inmediatamente arriba en la columna destino; null = primera. */
  afterTaskId: z.uuid().nullable(),
});

export type TaskRow = typeof tasks.$inferSelect;
type Ref = { id: string; label: string } | null;

// ─── Helpers internos ───────────────────────────────────────────────────

export async function loadTask(ex: Executor, taskId: string, forUpdate = false) {
  const query = ex
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));
  const [task] = forUpdate ? await query.for("update") : await query;
  if (!task) throw notFound("Tarea");
  return task;
}

async function getColumn(ex: Executor, projectId: string, columnId: string) {
  const [column] = await ex
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)));
  if (!column) throw badRequest("Columna inválida");
  return column;
}

async function firstColumn(ex: Executor, projectId: string) {
  const [column] = await ex
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.rank))
    .limit(1);
  if (!column) throw badRequest("El proyecto no tiene columnas");
  return column;
}

/** Valida que las referencias pertenezcan al proyecto y devuelve sus etiquetas para el historial. */
async function resolveRefs(
  ex: Executor,
  projectId: string,
  refs: {
    epicId?: string | null;
    sprintId?: string | null;
    assigneeId?: string | null;
    tagIds?: string[];
    parentId?: string | null;
  },
) {
  const out: { epic?: Ref; sprint?: Ref; assignee?: Ref; tags?: { id: string; name: string }[]; parent?: TaskRow | null } =
    {};
  if (refs.epicId !== undefined) {
    if (refs.epicId === null) out.epic = null;
    else {
      const [e] = await ex
        .select({ id: epics.id, label: epics.title })
        .from(epics)
        .where(and(eq(epics.id, refs.epicId), eq(epics.projectId, projectId), isNull(epics.deletedAt)));
      if (!e) throw badRequest("Epic inválido");
      out.epic = e;
    }
  }
  if (refs.sprintId !== undefined) {
    if (refs.sprintId === null) out.sprint = null;
    else {
      const [s] = await ex
        .select({ id: sprints.id, label: sprints.name, status: sprints.status })
        .from(sprints)
        .where(and(eq(sprints.id, refs.sprintId), eq(sprints.projectId, projectId)));
      if (!s) throw badRequest("Sprint inválido");
      if (s.status === "completed") throw badRequest("Ese sprint ya está cerrado");
      out.sprint = { id: s.id, label: s.label };
    }
  }
  if (refs.assigneeId !== undefined) {
    if (refs.assigneeId === null) out.assignee = null;
    else {
      const [m] = await ex
        .select({ id: user.id, label: user.name })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, refs.assigneeId)));
      if (!m) throw badRequest("El responsable tiene que ser miembro del proyecto");
      out.assignee = m;
    }
  }
  if (refs.tagIds !== undefined) {
    const unique = [...new Set(refs.tagIds)];
    const rows = unique.length
      ? await ex
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(and(eq(tags.projectId, projectId), inArray(tags.id, unique)))
      : [];
    if (rows.length !== unique.length) throw badRequest("Tag inválido");
    out.tags = rows;
  }
  if (refs.parentId !== undefined) {
    if (refs.parentId === null) out.parent = null;
    else {
      const [p] = await ex
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, refs.parentId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
      if (!p) throw badRequest("Tarea principal inválida");
      if (p.parentId) throw badRequest("Las subtareas no pueden tener subtareas");
      out.parent = p;
    }
  }
  return out;
}

async function edgeRank(ex: Executor, columnId: string, edge: "top" | "bottom", excludeId?: string) {
  const conditions = [eq(tasks.columnId, columnId), isNull(tasks.deletedAt)];
  if (excludeId) conditions.push(ne(tasks.id, excludeId));
  const [row] = await ex
    .select({ rank: tasks.rank })
    .from(tasks)
    .where(and(...conditions))
    .orderBy(edge === "top" ? asc(tasks.rank) : desc(tasks.rank))
    .limit(1);
  return row?.rank ?? null;
}

async function rankAtEdge(ex: Executor, columnId: string, edge: "top" | "bottom", excludeId?: string) {
  const current = await edgeRank(ex, columnId, edge, excludeId);
  return edge === "top" ? rankBetween(null, current) : rankBetween(current, null);
}

async function bottomBacklogRank(ex: Executor, projectId: string) {
  const [row] = await ex
    .select({ rank: tasks.backlogRank })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.backlogRank))
    .limit(1);
  return rankBetween(row?.rank ?? null, null);
}

// En serie: dentro de una transacción todas las queries comparten la misma conexión.
async function publishTaskChange(ex: Executor, actor: Actor, projectId: string, taskIds: string[]) {
  await publish(ex, projectChannel(projectId), { type: "board", taskIds }, actor);
  for (const taskId of taskIds) await publish(ex, projectChannel(projectId), { type: "task", taskId }, actor);
}

/**
 * Cambia la columna (y posición) de una tarea, aplicando efectos: fecha de finalización,
 * historial y evento `task.moved` para las automatizaciones.
 */
async function applyMove(tx: Tx, actor: Actor, task: TaskRow, columnId: string, rank: string) {
  const changes: Partial<TaskRow> = { rank };
  if (columnId !== task.columnId) {
    const from = await getColumn(tx, task.projectId, task.columnId);
    const to = await getColumn(tx, task.projectId, columnId);
    changes.columnId = columnId;
    if (to.category === "done") changes.completedAt = task.completedAt ?? new Date();
    else changes.completedAt = null;
    await logActivity(tx, actor, [
      {
        taskId: task.id,
        projectId: task.projectId,
        kind: "moved",
        field: "column",
        oldValue: { id: from.id, label: from.name },
        newValue: { id: to.id, label: to.name },
      },
    ]);
    await applyColumnTags(tx, actor, to, [task.id]);
    await emitDomainEvent(tx, {
      projectId: task.projectId,
      type: "task.moved",
      taskId: task.id,
      actor,
      payload: { fromColumnId: from.id, toColumnId: to.id },
    });
  }
  const [updated] = await tx.update(tasks).set(changes).where(eq(tasks.id, task.id)).returning();
  await publishTaskChange(tx, actor, task.projectId, [task.id]);
  return updated;
}

// ─── Operaciones ────────────────────────────────────────────────────────

export async function createTask(actor: Actor, input: z.input<typeof createTaskSchema>) {
  const data = createTaskSchema.parse(input);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, data.projectId, "task.create");
    const refs = await resolveRefs(tx, data.projectId, {
      epicId: data.epicId,
      sprintId: data.sprintId,
      assigneeId: data.assigneeId,
      tagIds: data.tagIds,
      parentId: data.parentId,
    });
    const column = data.columnId
      ? await getColumn(tx, data.projectId, data.columnId)
      : await firstColumn(tx, data.projectId);

    const [{ seq }] = await tx
      .update(projects)
      .set({ taskSeq: sql`${projects.taskSeq} + 1` })
      .where(eq(projects.id, data.projectId))
      .returning({ seq: projects.taskSeq });

    const parent = refs.parent ?? null;
    const [task] = await tx
      .insert(tasks)
      .values({
        projectId: data.projectId,
        number: seq,
        parentId: parent?.id ?? null,
        // Las subtareas viven en el sprint de su tarea principal.
        sprintId: parent ? parent.sprintId : (data.sprintId ?? null),
        epicId: data.epicId !== undefined ? data.epicId : (parent?.epicId ?? null),
        columnId: column.id,
        rank: await rankAtEdge(tx, column.id, data.position),
        backlogRank: await bottomBacklogRank(tx, data.projectId),
        title: data.title,
        descriptionMd: data.descriptionMd ?? "",
        priority: data.priority ?? "medium",
        assigneeId: data.assigneeId ?? null,
        reporterId: actorUserId(actor),
        dueDate: data.dueDate ?? null,
        estimateHours: data.estimateHours ?? null,
        completedAt: column.category === "done" ? new Date() : null,
      })
      .returning();

    // Tags elegidos más los automáticos de la columna.
    const tagIds = new Set([...(refs.tags ?? []).map((t) => t.id), ...(await columnTagIds(tx, column.id))]);
    if (tagIds.size) {
      await tx.insert(taskTags).values([...tagIds].map((tagId) => ({ taskId: task.id, tagId })));
    }
    await logActivity(tx, actor, [{ taskId: task.id, projectId: task.projectId, kind: "created" }]);
    await emitDomainEvent(tx, {
      projectId: task.projectId,
      type: "task.created",
      taskId: task.id,
      actor,
      payload: { columnId: column.id },
    });
    if (task.assigneeId) {
      await notify(tx, {
        userId: task.assigneeId,
        type: "assigned",
        projectId: task.projectId,
        taskId: task.id,
        actorId: actorUserId(actor),
      });
    }
    const affected = parent ? [task.id, parent.id] : [task.id];
    await publishTaskChange(tx, actor, task.projectId, affected);
    return task;
  });
}

const SCALAR_FIELDS = ["title", "descriptionMd", "priority", "dueDate", "estimateHours"] as const;

export async function updateTask(actor: Actor, input: z.input<typeof updateTaskSchema>) {
  const { taskId, columnId, tagIds, ...patch } = updateTaskSchema.parse(input);
  return db.transaction(async (tx) => {
    let task = await loadTask(tx, taskId, true);
    await authorize(tx, actor, task.projectId, "task.update");
    const refs = await resolveRefs(tx, task.projectId, {
      epicId: patch.epicId,
      sprintId: task.parentId ? undefined : patch.sprintId,
      assigneeId: patch.assigneeId,
      tagIds,
    });

    const changes: Partial<TaskRow> = {};
    const activity: ActivityEntry[] = [];
    const base = { taskId: task.id, projectId: task.projectId, kind: "updated" as const };

    for (const field of SCALAR_FIELDS) {
      const value = patch[field];
      if (value === undefined || value === task[field]) continue;
      (changes as Record<string, unknown>)[field] = value;
      activity.push({
        ...base,
        field,
        // La descripción completa no se duplica en el historial.
        oldValue: field === "descriptionMd" ? null : task[field],
        newValue: field === "descriptionMd" ? null : value,
      });
    }

    const refFields = [
      ["epicId", "epic", refs.epic],
      ["sprintId", "sprint", refs.sprint],
      ["assigneeId", "assignee", refs.assignee],
    ] as const;
    let previousRefs: Record<string, Ref> | null = null;
    for (const [field, name, ref] of refFields) {
      if (ref === undefined) continue;
      const next = ref?.id ?? null;
      if (next === task[field]) continue;
      previousRefs ??= await describeTaskRefs(tx, task);
      changes[field] = next;
      activity.push({ ...base, field: name, oldValue: previousRefs[name], newValue: ref });
    }

    if (refs.tags) {
      const current = await tx
        .select({ id: tags.id, name: tags.name })
        .from(taskTags)
        .innerJoin(tags, eq(tags.id, taskTags.tagId))
        .where(eq(taskTags.taskId, task.id));
      const currentIds = new Set(current.map((t) => t.id));
      const nextIds = new Set(refs.tags.map((t) => t.id));
      const added = refs.tags.filter((t) => !currentIds.has(t.id));
      const removed = current.filter((t) => !nextIds.has(t.id));
      if (added.length) {
        await tx.insert(taskTags).values(added.map((t) => ({ taskId: task.id, tagId: t.id })));
      }
      if (removed.length) {
        await tx.delete(taskTags).where(
          and(
            eq(taskTags.taskId, task.id),
            inArray(
              taskTags.tagId,
              removed.map((t) => t.id),
            ),
          ),
        );
      }
      if (added.length || removed.length) {
        activity.push({
          ...base,
          field: "tags",
          oldValue: current.map((t) => t.name),
          newValue: refs.tags.map((t) => t.name),
        });
      }
    }

    if (Object.keys(changes).length) {
      [task] = await tx.update(tasks).set(changes).where(eq(tasks.id, task.id)).returning();
    }
    await logActivity(tx, actor, activity);

    // Las subtareas siguen el sprint de su tarea principal.
    if (changes.sprintId !== undefined && !task.parentId) {
      await tx
        .update(tasks)
        .set({ sprintId: changes.sprintId })
        .where(and(eq(tasks.parentId, task.id), isNull(tasks.deletedAt)));
    }
    if (changes.assigneeId) {
      await notify(tx, {
        userId: changes.assigneeId,
        type: "assigned",
        projectId: task.projectId,
        taskId: task.id,
        actorId: actorUserId(actor),
      });
    }

    if (columnId && columnId !== task.columnId) {
      await getColumn(tx, task.projectId, columnId);
      task = await applyMove(tx, actor, task, columnId, await rankAtEdge(tx, columnId, "top"));
    } else {
      await publishTaskChange(tx, actor, task.projectId, task.parentId ? [task.id, task.parentId] : [task.id]);
    }
    return task;
  });
}

async function describeTaskRefs(ex: Executor, task: TaskRow): Promise<Record<string, Ref>> {
  const [row] = await ex
    .select({
      epic: sql<Ref>`case when ${epics.id} is null then null else json_build_object('id', ${epics.id}, 'label', ${epics.title}) end`,
      sprint: sql<Ref>`case when ${sprints.id} is null then null else json_build_object('id', ${sprints.id}, 'label', ${sprints.name}) end`,
      assignee: sql<Ref>`case when ${user.id} is null then null else json_build_object('id', ${user.id}, 'label', ${user.name}) end`,
    })
    .from(tasks)
    .leftJoin(epics, eq(epics.id, tasks.epicId))
    .leftJoin(sprints, eq(sprints.id, tasks.sprintId))
    .leftJoin(user, eq(user.id, tasks.assigneeId))
    .where(eq(tasks.id, task.id));
  return row ?? { epic: null, sprint: null, assignee: null };
}

export async function moveTask(actor: Actor, input: z.input<typeof moveTaskSchema>) {
  const { taskId, columnId, afterTaskId } = moveTaskSchema.parse(input);
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, taskId, true);
    await authorize(tx, actor, task.projectId, "task.update");
    await getColumn(tx, task.projectId, columnId);

    let prev: string | null = null;
    let next: string | null;
    const [after] =
      afterTaskId && afterTaskId !== taskId
        ? await tx
            .select({ rank: tasks.rank, columnId: tasks.columnId })
            .from(tasks)
            .where(and(eq(tasks.id, afterTaskId), isNull(tasks.deletedAt)))
        : [];

    if (!afterTaskId) {
      next = await edgeRank(tx, columnId, "top", taskId);
    } else if (after && after.columnId === columnId) {
      prev = after.rank;
      const [row] = await tx
        .select({ rank: tasks.rank })
        .from(tasks)
        .where(
          and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), ne(tasks.id, taskId), gt(tasks.rank, prev)),
        )
        .orderBy(asc(tasks.rank))
        .limit(1);
      next = row?.rank ?? null;
    } else {
      // El vecino ya no está en esa columna (cambio concurrente): al final.
      prev = await edgeRank(tx, columnId, "bottom", taskId);
      next = null;
    }
    return applyMove(tx, actor, task, columnId, rankBetween(prev, next));
  });
}

/** Mueve una tarea al principio de una columna. La usan las automatizaciones. */
export async function moveTaskToColumn(actor: Actor, taskId: string, columnId: string) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, taskId, true);
    await authorize(tx, actor, task.projectId, "task.update");
    await getColumn(tx, task.projectId, columnId);
    if (task.columnId === columnId) return { task, changed: false };
    const updated = await applyMove(tx, actor, task, columnId, await rankAtEdge(tx, columnId, "top", taskId));
    return { task: updated, changed: true };
  });
}

export async function deleteTask(actor: Actor, taskId: string) {
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, taskId, true);
    await authorize(tx, actor, task.projectId, "task.delete");
    const now = new Date();
    const deleted = await tx
      .update(tasks)
      .set({ deletedAt: now })
      .where(and(isNull(tasks.deletedAt), sql`(${tasks.id} = ${task.id} or ${tasks.parentId} = ${task.id})`))
      .returning({ id: tasks.id });
    await logActivity(tx, actor, [{ taskId: task.id, projectId: task.projectId, kind: "deleted" }]);
    const affected = deleted.map((d) => d.id);
    if (task.parentId) affected.push(task.parentId);
    await publishTaskChange(tx, actor, task.projectId, affected);
    return { id: task.id, deletedAt: now };
  });
}

/** Deshace un borrado reciente (la tarea y las subtareas borradas junto con ella). */
export async function restoreTask(actor: Actor, taskId: string) {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task || !task.deletedAt) throw notFound("Tarea");
    await authorize(tx, actor, task.projectId, "task.delete");
    const restored = await tx
      .update(tasks)
      .set({ deletedAt: null })
      .where(
        and(
          eq(tasks.deletedAt, task.deletedAt),
          sql`(${tasks.id} = ${task.id} or ${tasks.parentId} = ${task.id})`,
        ),
      )
      .returning({ id: tasks.id });
    await logActivity(tx, actor, [{ taskId: task.id, projectId: task.projectId, kind: "restored" }]);
    await publishTaskChange(tx, actor, task.projectId, restored.map((r) => r.id));
  });
}

// ─── Lectura ────────────────────────────────────────────────────────────

export async function findTaskId(actor: Actor, projectId: string, number: number) {
  await authorize(db, actor, projectId, "project.view");
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.number, number), isNull(tasks.deletedAt)));
  if (!row) throw notFound("Tarea");
  return row.id;
}

export async function getTaskDetail(actor: Actor, taskId: string) {
  const task = await loadTask(db, taskId);
  const role = await authorize(db, actor, task.projectId, "project.view");
  const [project] = await db
    .select({ key: projects.key, sprintsEnabled: projects.sprintsEnabled })
    .from(projects)
    .where(eq(projects.id, task.projectId));

  const [taskTagRows, subtasks, parent, commentRows, activityRows, links, attachments] = await Promise.all([
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(taskTags)
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(eq(taskTags.taskId, task.id))
      .orderBy(asc(tags.name)),
    db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        columnId: tasks.columnId,
        assigneeId: tasks.assigneeId,
        priority: tasks.priority,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.parentId, task.id), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.number)),
    task.parentId
      ? db
          .select({ id: tasks.id, number: tasks.number, title: tasks.title })
          .from(tasks)
          .where(eq(tasks.id, task.parentId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        id: comments.id,
        bodyMd: comments.bodyMd,
        source: comments.source,
        via: comments.via,
        createdAt: comments.createdAt,
        editedAt: comments.editedAt,
        author: { id: user.id, name: user.name, image: user.image },
        ruleName: automationRules.name,
      })
      .from(comments)
      .leftJoin(user, eq(user.id, comments.authorId))
      .leftJoin(automationRules, eq(automationRules.id, comments.automationRuleId))
      .where(eq(comments.taskId, task.id))
      .orderBy(asc(comments.createdAt)),
    db
      .select({
        id: taskActivity.id,
        kind: taskActivity.kind,
        field: taskActivity.field,
        oldValue: taskActivity.oldValue,
        newValue: taskActivity.newValue,
        actorType: taskActivity.actorType,
        actorId: taskActivity.actorId,
        via: taskActivity.via,
        createdAt: taskActivity.createdAt,
        userName: user.name,
        ruleName: automationRules.name,
      })
      .from(taskActivity)
      .leftJoin(user, and(eq(taskActivity.actorType, "user"), eq(user.id, taskActivity.actorId)))
      .leftJoin(
        automationRules,
        and(eq(taskActivity.actorType, "automation"), sql`${automationRules.id}::text = ${taskActivity.actorId}`),
      )
      .where(eq(taskActivity.taskId, task.id))
      .orderBy(desc(taskActivity.createdAt))
      .limit(100),
    db
      .select({
        id: taskVcsLinks.id,
        kind: taskVcsLinks.kind,
        externalId: taskVcsLinks.externalId,
        title: taskVcsLinks.title,
        url: taskVcsLinks.url,
        state: taskVcsLinks.state,
        data: taskVcsLinks.data,
        updatedAt: taskVcsLinks.updatedAt,
        repository: {
          id: projectRepositories.id,
          fullName: projectRepositories.fullName,
          provider: projectRepositories.provider,
        },
      })
      .from(taskVcsLinks)
      .innerJoin(projectRepositories, eq(projectRepositories.id, taskVcsLinks.projectRepositoryId))
      .where(eq(taskVcsLinks.taskId, task.id))
      .orderBy(desc(taskVcsLinks.updatedAt)),
    db
      .select({
        id: taskAttachments.id,
        fileName: taskAttachments.fileName,
        contentType: taskAttachments.contentType,
        sizeBytes: taskAttachments.sizeBytes,
        createdAt: taskAttachments.createdAt,
        uploadedBy: { id: user.id, name: user.name },
      })
      .from(taskAttachments)
      .leftJoin(user, eq(user.id, taskAttachments.uploadedById))
      .where(eq(taskAttachments.taskId, task.id))
      .orderBy(asc(taskAttachments.createdAt)),
  ]);

  return {
    ...task,
    key: taskKey(project.key, task.number),
    projectKey: project.key,
    sprintsEnabled: project.sprintsEnabled,
    role,
    tags: taskTagRows,
    subtasks,
    parent: parent ? { ...parent, key: taskKey(project.key, parent.number) } : null,
    comments: commentRows,
    activity: activityRows,
    links,
    attachments: attachments.map((a) => ({ ...a, url: `/api/attachments/${a.id}` })),
  };
}

export type TaskDetail = Awaited<ReturnType<typeof getTaskDetail>>;
