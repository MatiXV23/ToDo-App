import { TZDate } from "@date-fns/tz";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import {
  agentPullRequests,
  boardColumns,
  comments,
  epics,
  projectMembers,
  projectRepositories,
  projects,
  repoInstallations,
  tags,
  taskAttachments,
  taskTags,
  tasks,
  taskVcsLinks,
} from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { env } from "@/server/env";
import { projectChannel, publish } from "@/server/events";
import { can } from "@/server/permissions";
import { type Actor, authorize, getRole } from "@/server/permissions/access";
import { getProvider } from "@/server/repo-providers";
import { taskKey } from "@/lib/domain";
import { logActivity } from "./activity";
import { addComment } from "./comments";
import { createTag } from "./tags";
import { moveTaskToColumn } from "./tasks";

/**
 * Agente Claude: una rutina de Claude Code (en la nube) toma por MCP las tareas con el
 * tag del agente, las implementa en ramas y abre PRs. Los PRs "fáciles" los mergea ToDoApp
 * dentro de la ventana horaria si los checks pasan; los grandes esperan revisión humana.
 */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");

export const agentSettingsSchema = z.object({
  projectId: z.uuid(),
  enabled: z.boolean(),
  tagId: z.uuid().nullable().optional(),
  mergeFrom: HHMM,
  mergeUntil: HHMM,
});

// ─── Configuración ──────────────────────────────────────────────────────

export async function getAgentSettings(actor: Actor, projectId: string) {
  await authorize(db, actor, projectId, "project.view");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw notFound("Proyecto");
  const prs = await db
    .select({
      id: agentPullRequests.id,
      number: agentPullRequests.number,
      title: agentPullRequests.title,
      url: agentPullRequests.url,
      branch: agentPullRequests.branch,
      complexity: agentPullRequests.complexity,
      status: agentPullRequests.status,
      lastReason: agentPullRequests.lastReason,
      lastCheckAt: agentPullRequests.lastCheckAt,
      createdAt: agentPullRequests.createdAt,
      repo: projectRepositories.fullName,
    })
    .from(agentPullRequests)
    .innerJoin(projectRepositories, eq(projectRepositories.id, agentPullRequests.projectRepositoryId))
    .where(eq(agentPullRequests.projectId, projectId))
    .orderBy(desc(agentPullRequests.createdAt))
    .limit(20);
  return {
    enabled: project.agentEnabled,
    tagId: project.agentTagId,
    mergeFrom: project.agentMergeFrom,
    mergeUntil: project.agentMergeUntil,
    timezone: env.timezone,
    pullRequests: prs,
  };
}

export async function updateAgentSettings(actor: Actor, input: z.input<typeof agentSettingsSchema>) {
  const data = agentSettingsSchema.parse(input);
  await authorize(db, actor, data.projectId, "project.update");
  let tagId = data.tagId ?? null;
  if (data.enabled && !tagId) {
    // Al activarlo sin tag elegido se usa (o crea) el tag "IA".
    const [existing] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.projectId, data.projectId), eq(tags.name, "IA")));
    tagId = existing?.id ?? (await createTag(actor, { projectId: data.projectId, name: "IA", color: "#a855f7" })).id;
  }
  if (tagId) {
    const [tag] = await db.select().from(tags).where(and(eq(tags.id, tagId), eq(tags.projectId, data.projectId)));
    if (!tag) throw badRequest("Tag inválido");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ agentEnabled: data.enabled, agentTagId: tagId, agentMergeFrom: data.mergeFrom, agentMergeUntil: data.mergeUntil })
      .where(eq(projects.id, data.projectId));
    await publish(tx, projectChannel(data.projectId), { type: "project" }, actor);
  });
}

// ─── Cola de trabajo (para la rutina) ───────────────────────────────────

/** Proyectos con agente activo donde el actor puede editar tareas. */
async function agentProjects(actor: Actor, projectKey?: string) {
  if (actor.type !== "user") return [];
  const rows = await db
    .select({ project: projects, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.userId, actor.userId),
        eq(projects.agentEnabled, true),
        isNull(projects.archivedAt),
        projectKey ? eq(projects.key, projectKey.toUpperCase()) : undefined,
      ),
    );
  return rows.filter((r) => can(r.role, "task.update") && r.project.agentTagId).map((r) => r.project);
}

async function taskBrief(taskIds: string[], projectKey: string) {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      descriptionMd: tasks.descriptionMd,
      priority: tasks.priority,
      estimateHours: tasks.estimateHours,
      dueDate: tasks.dueDate,
      agentStatus: tasks.agentStatus,
      agentBranch: tasks.agentBranch,
      column: boardColumns.name,
      epic: epics.title,
    })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .leftJoin(epics, eq(epics.id, tasks.epicId))
    .where(inArray(tasks.id, taskIds))
    .orderBy(asc(tasks.rank));
  const [subtasks, commentRows, attachments] = await Promise.all([
    db
      .select({ parentId: tasks.parentId, number: tasks.number, title: tasks.title, done: tasks.completedAt })
      .from(tasks)
      .where(and(inArray(tasks.parentId, taskIds), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.number)),
    db
      .select({ taskId: comments.taskId, bodyMd: comments.bodyMd, createdAt: comments.createdAt, source: comments.source })
      .from(comments)
      .where(inArray(comments.taskId, taskIds))
      .orderBy(asc(comments.createdAt)),
    db
      .select({ taskId: taskAttachments.taskId, id: taskAttachments.id, fileName: taskAttachments.fileName })
      .from(taskAttachments)
      .where(inArray(taskAttachments.taskId, taskIds)),
  ]);
  return rows.map((t) => ({
    key: taskKey(projectKey, t.number),
    title: t.title,
    description: t.descriptionMd,
    priority: t.priority,
    estimateHours: t.estimateHours,
    dueDate: t.dueDate,
    column: t.column,
    epic: t.epic,
    agentStatus: t.agentStatus,
    agentBranch: t.agentBranch,
    subtasks: subtasks
      .filter((s) => s.parentId === t.id)
      .map((s) => ({ key: taskKey(projectKey, s.number), title: s.title, done: !!s.done })),
    comments: commentRows
      .filter((c) => c.taskId === t.id && c.source === "user")
      .slice(-10)
      .map((c) => ({ body: c.bodyMd, at: c.createdAt })),
    attachments: attachments
      .filter((a) => a.taskId === t.id)
      .map((a) => ({ fileName: a.fileName, url: `${env.appUrl}/api/attachments/${a.id}` })),
    url: `${env.appUrl}/p/${projectKey}?task=${taskKey(projectKey, t.number)}`,
  }));
}

/**
 * Tareas pendientes para el agente: con el tag, sin terminar y sin tomar.
 * También devuelve las ya tomadas sin PR, para retomarlas si una corrida anterior se cortó.
 */
export async function getAgentQueue(actor: Actor, projectKey?: string) {
  const result = [];
  for (const project of await agentProjects(actor, projectKey)) {
    const tagged = await db
      .select({ id: tasks.id, agentStatus: tasks.agentStatus })
      .from(tasks)
      .innerJoin(taskTags, eq(taskTags.taskId, tasks.id))
      .where(
        and(
          eq(tasks.projectId, project.id),
          eq(taskTags.tagId, project.agentTagId!),
          isNull(tasks.deletedAt),
          isNull(tasks.completedAt),
          isNull(tasks.parentId),
          or(isNull(tasks.agentStatus), eq(tasks.agentStatus, "claimed")),
        ),
      );
    const repos = await db
      .select({ fullName: projectRepositories.fullName, defaultBranch: projectRepositories.defaultBranch, url: projectRepositories.htmlUrl })
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, project.id));
    const queued = await taskBrief(tagged.filter((t) => !t.agentStatus).map((t) => t.id), project.key);
    const claimed = await taskBrief(tagged.filter((t) => t.agentStatus === "claimed").map((t) => t.id), project.key);
    if (queued.length || claimed.length) {
      result.push({
        project: { key: project.key, name: project.name },
        repositories: repos,
        mergeWindow: { from: project.agentMergeFrom, until: project.agentMergeUntil, timezone: env.timezone },
        queued,
        claimed,
      });
    }
  }
  return result;
}

async function loadAgentTasks(actor: Actor, keys: string[]) {
  if (keys.length === 0) throw badRequest("Indicá al menos una tarea");
  const out: { task: typeof tasks.$inferSelect; project: typeof projects.$inferSelect }[] = [];
  for (const key of keys) {
    const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(key.trim());
    if (!match) throw badRequest(`Clave inválida: ${key}`);
    const [row] = await db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(projects.key, match[1].toUpperCase()), eq(tasks.number, Number(match[2])), isNull(tasks.deletedAt)));
    if (!row) throw notFound(`Tarea ${key}`);
    await authorize(db, actor, row.project.id, "task.update");
    out.push(row);
  }
  return out;
}

export const claimSchema = z.object({
  tasks: z.array(z.string()).min(1).max(10),
  branch: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._\-/]+$/, "Nombre de rama inválido"),
});

/** El agente toma tareas: quedan "en curso" a su nombre, con la rama donde va a trabajar. */
export async function claimTasks(actor: Actor, input: z.input<typeof claimSchema>) {
  const { tasks: keys, branch } = claimSchema.parse(input);
  const rows = await loadAgentTasks(actor, keys);
  for (const { task, project } of rows) {
    if (task.completedAt) throw badRequest(`${taskKey(project.key, task.number)} ya está terminada`);
    await db
      .update(tasks)
      .set({ agentStatus: "claimed", agentBranch: branch, agentClaimedAt: new Date() })
      .where(eq(tasks.id, task.id));
    // Si estaba en una columna "pendiente", pasa a la primera "en progreso".
    const [current] = await db.select().from(boardColumns).where(eq(boardColumns.id, task.columnId));
    if (current?.category === "todo") {
      const [doing] = await db
        .select()
        .from(boardColumns)
        .where(and(eq(boardColumns.projectId, project.id), eq(boardColumns.category, "in_progress")))
        .orderBy(asc(boardColumns.rank))
        .limit(1);
      if (doing) await moveTaskToColumn(actor, task.id, doing.id);
    }
    await db.transaction(async (tx) => {
      await logActivity(tx, actor, [{ taskId: task.id, projectId: project.id, kind: "agent", field: "claimed", newValue: { id: branch, label: branch } }]);
      await publish(tx, projectChannel(project.id), { type: "board", taskIds: [task.id] }, actor);
    });
    await addComment(actor, { taskId: task.id, bodyMd: `🤖 Tomé esta tarea. Voy a trabajar en la rama \`${branch}\`.` });
  }
  return { claimed: rows.map(({ task, project }) => taskKey(project.key, task.number)), branch };
}

export const submitPrSchema = z.object({
  tasks: z.array(z.string()).min(1).max(10),
  repository: z.string().trim().min(3),
  number: z.number().int().positive(),
  url: z.url(),
  title: z.string().max(300).default(""),
  branch: z.string().trim().min(1).max(200),
  complexity: z.enum(["easy", "large"]),
  summary: z.string().max(10_000).default(""),
});

/** Registra el PR que abrió el agente para esas tareas. Los "easy" quedan para merge automático. */
export async function submitPullRequest(actor: Actor, input: z.input<typeof submitPrSchema>) {
  const data = submitPrSchema.parse(input);
  const rows = await loadAgentTasks(actor, data.tasks);
  const project = rows[0].project;
  if (rows.some((r) => r.project.id !== project.id)) throw badRequest("Todas las tareas de un PR tienen que ser del mismo proyecto");
  const [repo] = await db
    .select()
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, project.id), eq(projectRepositories.fullName, data.repository)));
  if (!repo) throw badRequest(`El repositorio ${data.repository} no está conectado a ${project.key}`);

  const status = data.complexity === "easy" ? "pending" : "waiting_review";
  await db.transaction(async (tx) => {
    await tx
      .insert(agentPullRequests)
      .values({
        projectId: project.id,
        projectRepositoryId: repo.id,
        number: data.number,
        branch: data.branch,
        title: data.title,
        url: data.url,
        complexity: data.complexity,
        summary: data.summary,
        taskIds: rows.map((r) => r.task.id),
        status,
      })
      .onConflictDoUpdate({
        target: [agentPullRequests.projectRepositoryId, agentPullRequests.number],
        set: { complexity: data.complexity, summary: data.summary, title: data.title, taskIds: rows.map((r) => r.task.id), status },
      });
    for (const { task } of rows) {
      await tx.update(tasks).set({ agentStatus: "pr_open", agentBranch: data.branch }).where(eq(tasks.id, task.id));
      await tx
        .insert(taskVcsLinks)
        .values({
          taskId: task.id,
          projectRepositoryId: repo.id,
          kind: "pull_request",
          externalId: String(data.number),
          title: data.title,
          url: data.url,
          state: "open",
          data: { headBranch: data.branch, author: "claude" },
        })
        .onConflictDoNothing();
      await logActivity(tx, actor, [
        { taskId: task.id, projectId: project.id, kind: "agent", field: "pr", newValue: { id: String(data.number), label: `PR #${data.number}` } },
      ]);
    }
    await publish(tx, projectChannel(project.id), { type: "board", taskIds: rows.map((r) => r.task.id) }, actor);
  });

  const mergeNote =
    data.complexity === "easy"
      ? `Es un cambio chico: se mergea solo entre las ${project.agentMergeFrom} y las ${project.agentMergeUntil} si los checks pasan.`
      : "Es un cambio grande: queda esperando tu revisión para mergear.";
  for (const { task } of rows) {
    await addComment(actor, {
      taskId: task.id,
      bodyMd: `🤖 Abrí el PR [#${data.number}](${data.url}) en \`${data.branch}\`. ${mergeNote}${data.summary ? `\n\n${data.summary}` : ""}`,
    });
  }
  return { registered: rows.map(({ task }) => taskKey(project.key, task.number)), autoMerge: data.complexity === "easy" };
}

export const releaseSchema = z.object({
  task: z.string(),
  reason: z.string().trim().min(1).max(5000),
  /** true: queda bloqueada hasta que alguien responda; false: vuelve a la cola. */
  blocked: z.boolean().default(true),
});

export async function releaseTask(actor: Actor, input: z.input<typeof releaseSchema>) {
  const data = releaseSchema.parse(input);
  const [{ task, project }] = await loadAgentTasks(actor, [data.task]);
  await db
    .update(tasks)
    .set({ agentStatus: data.blocked ? "blocked" : null, agentBranch: data.blocked ? task.agentBranch : null })
    .where(eq(tasks.id, task.id));
  await addComment(actor, {
    taskId: task.id,
    bodyMd: `🤖 ${data.blocked ? "No pude completar esta tarea" : "Devuelvo esta tarea a la cola"}:\n\n${data.reason}`,
  });
  await db.transaction(async (tx) => {
    await publish(tx, projectChannel(project.id), { type: "board", taskIds: [task.id] }, actor);
  });
  return { task: taskKey(project.key, task.number), status: data.blocked ? "blocked" : "queued" };
}

/** Vuelve a poner en cola una tarea bloqueada (desde la UI). */
export async function requeueTask(actor: Actor, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound("Tarea");
  await authorize(db, actor, task.projectId, "task.update");
  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ agentStatus: null, agentBranch: null }).where(eq(tasks.id, taskId));
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [taskId] }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId }, actor);
  });
}

// ─── Merge automático ───────────────────────────────────────────────────

export function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** ¿`now` cae dentro de la ventana [from, until)? Soporta ventanas que cruzan la medianoche. */
export function inMergeWindow(now: Date, from: string, until: string, timezone: string) {
  const local = new TZDate(now, timezone);
  const t = local.getHours() * 60 + local.getMinutes();
  const a = minutesOf(from);
  const b = minutesOf(until);
  if (a === b) return true;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/**
 * Revisa los PRs "fáciles" del agente: dentro de la ventana horaria, si GitHub dice que
 * están listos (checks en verde, sin conflictos), los mergea. El webhook de merge hace el resto
 * (automatizaciones, mover a Hecho) y el Action del repo despliega.
 */
export async function runAgentAutoMerge(now = new Date()) {
  const candidates = await db
    .select({
      pr: agentPullRequests,
      project: projects,
      repoFullName: projectRepositories.fullName,
      provider: projectRepositories.provider,
      installationExternalId: repoInstallations.externalId,
    })
    .from(agentPullRequests)
    .innerJoin(projects, eq(projects.id, agentPullRequests.projectId))
    .innerJoin(projectRepositories, eq(projectRepositories.id, agentPullRequests.projectRepositoryId))
    .innerJoin(repoInstallations, eq(repoInstallations.id, projectRepositories.installationId))
    .where(
      and(
        eq(agentPullRequests.status, "pending"),
        eq(agentPullRequests.complexity, "easy"),
        or(isNull(agentPullRequests.lastCheckAt), lt(agentPullRequests.lastCheckAt, new Date(now.getTime() - 4 * 60_000))),
      ),
    );

  for (const { pr, project, repoFullName, provider: providerId, installationExternalId } of candidates) {
    if (!project.agentEnabled) continue;
    if (!inMergeWindow(now, project.agentMergeFrom, project.agentMergeUntil, env.timezone)) continue;
    const provider = getProvider(providerId);
    if (!provider?.isConfigured()) continue;
    const repo = { fullName: repoFullName };
    let reason: string;
    let status = "pending";
    try {
      const current = await provider.pullRequestStatus(installationExternalId, repo, pr.number);
      if (current.merged) {
        status = "merged";
        reason = "Ya estaba mergeado";
      } else if (current.state === "closed") {
        status = "closed";
        reason = "El PR se cerró sin mergear";
      } else if (current.draft) {
        reason = "Es un borrador";
      } else if (current.mergeableState === "clean") {
        const result = await provider.mergePullRequest(installationExternalId, repo, pr.number);
        status = result.merged ? "merged" : "pending";
        reason = result.merged ? "Mergeado automáticamente" : `No se pudo mergear: ${result.message}`;
      } else {
        reason =
          {
            blocked: "Faltan checks o aprobaciones requeridas",
            unstable: "Hay checks fallando",
            dirty: "Tiene conflictos con la rama base",
            behind: "Está desactualizado respecto de la rama base",
            unknown: "GitHub todavía está calculando si se puede mergear",
          }[current.mergeableState] ?? `Estado de merge: ${current.mergeableState}`;
      }
    } catch (err) {
      reason = `Error consultando GitHub: ${err instanceof Error ? err.message : String(err)}`;
    }
    await db
      .update(agentPullRequests)
      .set({ status, lastReason: reason, lastCheckAt: now, mergedAt: status === "merged" ? now : null })
      .where(eq(agentPullRequests.id, pr.id));
    if (status === "merged") {
      await db.update(tasks).set({ agentStatus: "merged" }).where(inArray(tasks.id, pr.taskIds));
    }
  }
}

/** Lo llama el webhook cuando un PR se mergea o cierra (también los grandes, mergeados a mano). */
export async function onPullRequestClosed(projectRepositoryId: string, number: number, merged: boolean) {
  const [pr] = await db
    .select()
    .from(agentPullRequests)
    .where(and(eq(agentPullRequests.projectRepositoryId, projectRepositoryId), eq(agentPullRequests.number, number)));
  if (!pr || pr.status === "merged") return;
  await db
    .update(agentPullRequests)
    .set({ status: merged ? "merged" : "closed", mergedAt: merged ? new Date() : null, lastReason: merged ? "Mergeado" : "Cerrado sin mergear" })
    .where(eq(agentPullRequests.id, pr.id));
  if (merged) await db.update(tasks).set({ agentStatus: "merged" }).where(inArray(tasks.id, pr.taskIds));
}

export async function canUseAgent(actor: Actor, projectId: string) {
  if (actor.type !== "user") return false;
  return can(await getRole(db, projectId, actor.userId), "task.update");
}
