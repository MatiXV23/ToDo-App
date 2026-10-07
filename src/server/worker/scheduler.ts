import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { automationRules, automationRuns, domainEvents, dueReminders, tasks, webhookDeliveries } from "@/server/db/schema";
import { env } from "@/server/env";
import { runRule } from "@/server/automations/executor";
import { triggerSchema } from "@/lib/automation-schema";
import { runAgentAutoMerge } from "@/server/services/agent";
import { notify } from "@/server/services/notifications";

/**
 * Tareas no terminadas cuya fecha límite (fin del día, en la zona horaria configurada)
 * cae dentro de las próximas `hours` horas.
 */
async function tasksDueWithin(hours: number, projectId?: string) {
  const dueAt = sql`((${tasks.dueDate} + 1)::timestamp at time zone ${env.timezone})`;
  const conditions = [
    isNull(tasks.deletedAt),
    isNull(tasks.completedAt),
    isNotNull(tasks.dueDate),
    sql`now() >= ${dueAt} - make_interval(hours => ${hours})`,
    sql`now() < ${dueAt}`,
  ];
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  return db
    .select({ id: tasks.id, projectId: tasks.projectId, dueDate: tasks.dueDate, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(...conditions));
}

/** Registra el aviso; devuelve false si ya se había disparado para esa fecha. */
async function claimReminder(taskId: string, dueDate: string, kind: string) {
  const inserted = await db.insert(dueReminders).values({ taskId, dueDate, kind }).onConflictDoNothing().returning();
  return inserted.length > 0;
}

/** Reglas con disparador "fecha límite próxima". */
export async function runDueSoonRules() {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.enabled, true), sql`${automationRules.trigger}->>'type' = 'task.due_soon'`));
  for (const rule of rules) {
    const trigger = triggerSchema.safeParse(rule.trigger);
    if (!trigger.success || trigger.data.type !== "task.due_soon") continue;
    for (const task of await tasksDueWithin(trigger.data.hoursBefore, rule.projectId)) {
      if (!(await claimReminder(task.id, task.dueDate!, rule.id))) continue;
      await runRule(
        rule,
        {
          type: "task.due_soon",
          taskId: task.id,
          payload: { dueDate: task.dueDate, hoursBefore: trigger.data.hoursBefore },
          depth: 0,
          ruleChain: [],
        },
        null,
      );
    }
  }
}

/** Aviso en el buzón del responsable 24 h antes del vencimiento. */
export async function notifyDueSoon() {
  for (const task of await tasksDueWithin(24)) {
    if (!task.assigneeId) continue;
    if (!(await claimReminder(task.id, task.dueDate!, "notify"))) continue;
    await notify(db, {
      userId: task.assigneeId,
      type: "due_soon",
      projectId: task.projectId,
      taskId: task.id,
      data: { dueDate: task.dueDate },
    });
  }
}

/** Limpieza de registros viejos. */
async function cleanup() {
  const days = (n: number) => sql`now() - make_interval(days => ${n})`;
  await db.delete(automationRuns).where(lt(automationRuns.createdAt, days(30)));
  await db.delete(domainEvents).where(and(isNotNull(domainEvents.processedAt), lt(domainEvents.createdAt, days(7))));
  await db.delete(webhookDeliveries).where(and(isNotNull(webhookDeliveries.processedAt), lt(webhookDeliveries.receivedAt, days(14))));
}

let lastCleanup = 0;

export async function runScheduledJobs() {
  await runDueSoonRules();
  await notifyDueSoon();
  await runAgentAutoMerge();
  if (Date.now() - lastCleanup > 6 * 60 * 60_000) {
    lastCleanup = Date.now();
    await cleanup();
  }
}
