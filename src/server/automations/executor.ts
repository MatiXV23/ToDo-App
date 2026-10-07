import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  automationRules,
  automationRuns,
  boardColumns,
  domainEvents,
  epics,
  projectMembers,
  projects,
  tags,
  taskTags,
  tasks,
  user,
} from "@/server/db/schema";
import { projectChannel, publish } from "@/server/events";
import type { Actor } from "@/server/permissions/access";
import { addComment } from "@/server/services/comments";
import { moveTaskToColumn, updateTask } from "@/server/services/tasks";
import { type Action, ruleInputSchema, type TriggerType } from "@/lib/automation-schema";
import { type EngineEvent, type EngineRule, type Labels, planRun, renderTemplate, type TaskSnapshot } from "./engine";

type RuleRow = typeof automationRules.$inferSelect;

export async function loadTaskSnapshot(taskId: string): Promise<TaskSnapshot | null> {
  const [row] = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      projectKey: projects.key,
      columnId: tasks.columnId,
      priority: tasks.priority,
      epicId: tasks.epicId,
      assigneeId: tasks.assigneeId,
      parentId: tasks.parentId,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));
  if (!row) return null;
  const tagRows = await db.select({ tagId: taskTags.tagId }).from(taskTags).where(eq(taskTags.taskId, taskId));
  return { ...row, tagIds: tagRows.map((t) => t.tagId) };
}

/** Etiquetas legibles (nombres de columnas, tags, etc.) para explicar cada decisión. */
async function loadLabels(projectId: string): Promise<Labels> {
  const [cols, tagRows, epicRows] = await Promise.all([
    db.select({ id: boardColumns.id, name: boardColumns.name }).from(boardColumns).where(eq(boardColumns.projectId, projectId)),
    db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.projectId, projectId)),
    db.select({ id: epics.id, title: epics.title }).from(epics).where(eq(epics.projectId, projectId)),
  ]);
  const columns = new Map(cols.map((c) => [c.id, c.name]));
  const tagNames = new Map(tagRows.map((t) => [t.id, t.name]));
  const epicNames = new Map(epicRows.map((e) => [e.id, e.title]));
  const userRows = await db
    .select({ id: user.id, name: user.name })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId));
  const users = new Map(userRows.map((u) => [u.id, u.name]));
  return {
    column: (id) => (id ? (columns.get(id) ?? "columna borrada") : "—"),
    tag: (id) => tagNames.get(id) ?? "tag borrado",
    epic: (id) => (id ? (epicNames.get(id) ?? "epic borrado") : "sin epic"),
    user: (id) => (id ? (users.get(id) ?? "usuario desconocido") : "sin responsable"),
  };
}

type ActionResult = { action: Action; ok: boolean; changed: boolean; message: string };

async function executeAction(actor: Actor, action: Action, task: TaskSnapshot, event: EngineEvent, labels: Labels): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "move_to_column": {
        const { changed } = await moveTaskToColumn(actor, task.id, action.columnId);
        return {
          action,
          ok: true,
          changed,
          message: changed ? `Movida a ${labels.column(action.columnId)}` : `Ya estaba en ${labels.column(action.columnId)}`,
        };
      }
      case "assign": {
        const current = await loadTaskSnapshot(task.id);
        if (current?.assigneeId === action.userId) {
          return { action, ok: true, changed: false, message: `Ya estaba asignada a ${labels.user(action.userId)}` };
        }
        await updateTask(actor, { taskId: task.id, assigneeId: action.userId });
        return { action, ok: true, changed: true, message: `Asignada a ${labels.user(action.userId)}` };
      }
      case "add_tag":
      case "remove_tag": {
        const current = (await loadTaskSnapshot(task.id))?.tagIds ?? [];
        const has = current.includes(action.tagId);
        if ((action.type === "add_tag" && has) || (action.type === "remove_tag" && !has)) {
          return { action, ok: true, changed: false, message: `Sin cambios en el tag ${labels.tag(action.tagId)}` };
        }
        const tagIds = action.type === "add_tag" ? [...current, action.tagId] : current.filter((t) => t !== action.tagId);
        await updateTask(actor, { taskId: task.id, tagIds });
        return {
          action,
          ok: true,
          changed: true,
          message: `${action.type === "add_tag" ? "Agregado" : "Quitado"} el tag ${labels.tag(action.tagId)}`,
        };
      }
      case "add_comment": {
        await addComment(actor, { taskId: task.id, bodyMd: renderTemplate(action.body, task, event.payload) });
        return { action, ok: true, changed: true, message: "Comentario agregado" };
      }
    }
  } catch (err) {
    return { action, ok: false, changed: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function recordRun(input: {
  id?: string;
  rule: RuleRow;
  event: EngineEvent;
  eventId: number | null;
  taskId: string | null;
  status: "success" | "skipped" | "failed";
  reason: string | null;
  details: Record<string, unknown>;
}) {
  await db.insert(automationRuns).values({
    id: input.id ?? randomUUID(),
    ruleId: input.rule.id,
    projectId: input.rule.projectId,
    taskId: input.taskId,
    eventId: input.eventId,
    triggerType: input.event.type,
    status: input.status,
    reason: input.reason,
    details: input.details,
    depth: input.event.depth,
  });
}

/** Evalúa y, si corresponde, ejecuta una regla para un evento. Siempre deja registro. */
export async function runRule(rule: RuleRow, event: EngineEvent, eventId: number | null, labels?: Labels) {
  const parsed = ruleInputSchema.safeParse({ ...rule, conditions: rule.conditions, actions: rule.actions });
  if (!parsed.success) {
    await recordRun({ rule, event, eventId, taskId: event.taskId, status: "failed", reason: "La regla tiene una configuración inválida", details: {} });
    return;
  }
  const task = await loadTaskSnapshot(event.taskId);
  if (!task) {
    await recordRun({ rule, event, eventId, taskId: null, status: "skipped", reason: "La tarea ya no existe", details: {} });
    return;
  }
  const l = labels ?? (await loadLabels(rule.projectId));
  const engineRule: EngineRule = { ...parsed.data, id: rule.id };
  const plan = planRun(engineRule, event, task, l);
  const eventDetails = { type: event.type, payload: event.payload, depth: event.depth };

  if (plan.decision === "skip") {
    await recordRun({
      rule,
      event,
      eventId,
      taskId: task.id,
      status: "skipped",
      reason: plan.reason,
      details: { event: eventDetails, conditions: plan.conditions.map(({ description, actual, passed }) => ({ description, actual, passed })) },
    });
    return;
  }

  const runId = randomUUID();
  const actor: Actor = {
    type: "automation",
    ruleId: rule.id,
    runId,
    depth: event.depth + 1,
    chain: [...event.ruleChain, rule.id],
  };
  const results: ActionResult[] = [];
  for (const action of plan.actions) results.push(await executeAction(actor, action, task, event, l));
  const failed = results.filter((r) => !r.ok);
  await recordRun({
    id: runId,
    rule,
    event,
    eventId,
    taskId: task.id,
    status: failed.length ? "failed" : "success",
    reason: failed.length ? `Falló: ${failed.map((f) => f.message).join("; ")}` : null,
    details: {
      event: eventDetails,
      conditions: plan.conditions.map(({ description, actual, passed }) => ({ description, actual, passed })),
      actions: results.map(({ action, ok, changed, message }) => ({ type: action.type, ok, changed, message })),
    },
  });
}

/** Punto de entrada del worker para cada evento del outbox. */
export async function handleDomainEvent(event: typeof domainEvents.$inferSelect) {
  if (!event.taskId) return;
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.projectId, event.projectId),
        eq(automationRules.enabled, true),
        sql`${automationRules.trigger}->>'type' = ${event.type}`,
      ),
    )
    .orderBy(asc(automationRules.createdAt));
  if (rules.length === 0) return;

  const engineEvent: EngineEvent = {
    type: event.type as TriggerType,
    taskId: event.taskId,
    payload: event.payload,
    depth: event.depth,
    ruleChain: event.ruleChain,
  };
  const labels = await loadLabels(event.projectId);
  for (const rule of rules) await runRule(rule, engineEvent, event.id, labels);
  // Las pantallas de automatizaciones muestran el registro en vivo.
  await publish(db, projectChannel(event.projectId), { type: "automation" });
}
