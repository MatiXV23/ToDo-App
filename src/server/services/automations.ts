import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { db, type Executor } from "@/server/db";
import { automationRules, automationRuns, boardColumns, epics, projectMembers, projects, tags, tasks } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, actorUserId, authorize } from "@/server/permissions/access";
import { type RuleInput, ruleInputSchema } from "@/lib/automation-schema";

/** Verifica que columnas, tags, epics y personas usados por la regla sean del proyecto. */
async function validateReferences(ex: Executor, projectId: string, rule: RuleInput) {
  const columnIds = new Set<string>();
  const tagIds = new Set<string>();
  const epicIds = new Set<string>();
  const userIds = new Set<string>();
  if (rule.trigger.type === "task.moved") {
    if (rule.trigger.fromColumnId) columnIds.add(rule.trigger.fromColumnId);
    if (rule.trigger.toColumnId) columnIds.add(rule.trigger.toColumnId);
  }
  for (const c of rule.conditions) {
    if (c.type === "column") columnIds.add(c.columnId);
    if (c.type === "tag") tagIds.add(c.tagId);
    if (c.type === "epic" && c.epicId) epicIds.add(c.epicId);
    if (c.type === "assignee" && c.userId) userIds.add(c.userId);
  }
  for (const a of rule.actions) {
    if (a.type === "move_to_column") columnIds.add(a.columnId);
    if (a.type === "add_tag" || a.type === "remove_tag") tagIds.add(a.tagId);
    if (a.type === "assign" && a.userId) userIds.add(a.userId);
  }
  const check = async (ids: Set<string>, count: () => Promise<number>, what: string) => {
    if (ids.size && (await count()) !== ids.size) throw badRequest(`La regla usa ${what} que no pertenece al proyecto`);
  };
  await check(columnIds, async () => (await ex.select({ id: boardColumns.id }).from(boardColumns).where(and(eq(boardColumns.projectId, projectId), inArray(boardColumns.id, [...columnIds])))).length, "una columna");
  await check(tagIds, async () => (await ex.select({ id: tags.id }).from(tags).where(and(eq(tags.projectId, projectId), inArray(tags.id, [...tagIds])))).length, "un tag");
  await check(epicIds, async () => (await ex.select({ id: epics.id }).from(epics).where(and(eq(epics.projectId, projectId), inArray(epics.id, [...epicIds])))).length, "un epic");
  await check(userIds, async () => (await ex.select({ id: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, [...userIds])))).length, "una persona");
}

export const createRuleSchema = ruleInputSchema.extend({ projectId: z.uuid() });
export const updateRuleSchema = ruleInputSchema.extend({ ruleId: z.uuid() });

export async function listRules(actor: Actor, projectId: string) {
  await authorize(db, actor, projectId, "automation.view");
  const lastRun = db
    .select({
      ruleId: automationRuns.ruleId,
      lastRunAt: sql<Date>`max(${automationRuns.createdAt})`.as("last_run_at"),
      runs: sql<number>`count(*) filter (where ${automationRuns.status} = 'success')`.as("runs"),
      failures: sql<number>`count(*) filter (where ${automationRuns.status} = 'failed')`.as("failures"),
    })
    .from(automationRuns)
    .where(eq(automationRuns.projectId, projectId))
    .groupBy(automationRuns.ruleId)
    .as("last_run");
  const rows = await db
    .select({
      id: automationRules.id,
      name: automationRules.name,
      enabled: automationRules.enabled,
      trigger: automationRules.trigger,
      conditions: automationRules.conditions,
      actions: automationRules.actions,
      createdAt: automationRules.createdAt,
      lastRunAt: lastRun.lastRunAt,
      runs: sql<number>`coalesce(${lastRun.runs}, 0)`.mapWith(Number),
      failures: sql<number>`coalesce(${lastRun.failures}, 0)`.mapWith(Number),
    })
    .from(automationRules)
    .leftJoin(lastRun, eq(lastRun.ruleId, automationRules.id))
    .where(eq(automationRules.projectId, projectId))
    .orderBy(automationRules.createdAt);
  return rows.map((r) => ({ ...r, ...(ruleInputSchema.safeParse(r).data ?? {}), valid: ruleInputSchema.safeParse(r).success }));
}

export async function createRule(actor: Actor, input: z.input<typeof createRuleSchema>) {
  const { projectId, ...rule } = createRuleSchema.parse(input);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, projectId, "automation.manage");
    await validateReferences(tx, projectId, rule);
    const [row] = await tx
      .insert(automationRules)
      .values({ projectId, ...rule, createdById: actorUserId(actor) })
      .returning();
    await publish(tx, projectChannel(projectId), { type: "automation" }, actor);
    return row;
  });
}

async function loadRule(ruleId: string) {
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, ruleId));
  if (!rule) throw notFound("Regla");
  return rule;
}

export async function updateRule(actor: Actor, input: z.input<typeof updateRuleSchema>) {
  const { ruleId, ...rule } = updateRuleSchema.parse(input);
  const existing = await loadRule(ruleId);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, existing.projectId, "automation.manage");
    await validateReferences(tx, existing.projectId, rule);
    const [row] = await tx.update(automationRules).set(rule).where(eq(automationRules.id, ruleId)).returning();
    await publish(tx, projectChannel(existing.projectId), { type: "automation" }, actor);
    return row;
  });
}

export async function setRuleEnabled(actor: Actor, ruleId: string, enabled: boolean) {
  const existing = await loadRule(ruleId);
  await db.transaction(async (tx) => {
    await authorize(tx, actor, existing.projectId, "automation.manage");
    await tx.update(automationRules).set({ enabled }).where(eq(automationRules.id, ruleId));
    await publish(tx, projectChannel(existing.projectId), { type: "automation" }, actor);
  });
}

export async function deleteRule(actor: Actor, ruleId: string) {
  const existing = await loadRule(ruleId);
  await db.transaction(async (tx) => {
    await authorize(tx, actor, existing.projectId, "automation.manage");
    await tx.delete(automationRules).where(eq(automationRules.id, ruleId));
    await publish(tx, projectChannel(existing.projectId), { type: "automation" }, actor);
  });
}

export async function listRuns(actor: Actor, input: { projectId: string; ruleId?: string; status?: "success" | "skipped" | "failed"; limit?: number }) {
  await authorize(db, actor, input.projectId, "automation.view");
  const conditions = [eq(automationRuns.projectId, input.projectId)];
  if (input.ruleId) conditions.push(eq(automationRuns.ruleId, input.ruleId));
  if (input.status) conditions.push(eq(automationRuns.status, input.status));
  return db
    .select({
      id: automationRuns.id,
      ruleId: automationRuns.ruleId,
      ruleName: automationRules.name,
      triggerType: automationRuns.triggerType,
      status: automationRuns.status,
      reason: automationRuns.reason,
      details: automationRuns.details,
      depth: automationRuns.depth,
      createdAt: automationRuns.createdAt,
      task: { id: tasks.id, number: tasks.number, title: tasks.title },
      projectKey: projects.key,
    })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
    .innerJoin(projects, eq(projects.id, automationRuns.projectId))
    .leftJoin(tasks, eq(tasks.id, automationRuns.taskId))
    .where(and(...conditions))
    .orderBy(desc(automationRuns.createdAt))
    .limit(Math.min(input.limit ?? 100, 300));
}
