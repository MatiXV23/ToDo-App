import type { Action, Condition, RuleInput, Trigger, TriggerType } from "@/lib/automation-schema";
import { type Priority, PRIORITY_META } from "@/lib/domain";

/**
 * Motor de automatizaciones: funciones puras que deciden si una regla corre y por qué.
 * La ejecución (que sí toca la base) está en executor.ts.
 */

/** Profundidad máxima de una cadena regla → evento → regla. */
export const MAX_CHAIN_DEPTH = 3;

export type TaskSnapshot = {
  id: string;
  number: number;
  title: string;
  projectKey: string;
  columnId: string;
  priority: Priority;
  epicId: string | null;
  assigneeId: string | null;
  parentId: string | null;
  dueDate: string | null;
  tagIds: string[];
};

export type EngineEvent = {
  type: TriggerType;
  taskId: string;
  payload: Record<string, unknown>;
  /** 0 = acción humana o externa; cada regla encadenada suma 1. */
  depth: number;
  /** Reglas que ya actuaron en esta cadena. */
  ruleChain: string[];
};

export type EngineRule = { id: string; name: string } & Pick<RuleInput, "trigger" | "conditions" | "actions">;

/** Nombres legibles para explicar las decisiones en el registro. */
export type Labels = {
  column: (id: string | null | undefined) => string;
  tag: (id: string) => string;
  epic: (id: string | null) => string;
  user: (id: string | null) => string;
};

export const plainLabels: Labels = {
  column: (id) => id ?? "—",
  tag: (id) => id,
  epic: (id) => id ?? "sin epic",
  user: (id) => id ?? "sin responsable",
};

export type ConditionResult = { condition: Condition; passed: boolean; description: string; actual: string };

export type RunPlan =
  | { decision: "skip"; reason: string; conditions: ConditionResult[] }
  | { decision: "run"; conditions: ConditionResult[]; actions: Action[] };

export function triggerMatches(trigger: Trigger, event: EngineEvent, labels: Labels = plainLabels): { matched: boolean; reason?: string } {
  if (trigger.type !== event.type) return { matched: false, reason: "El disparador es de otro tipo" };
  if (trigger.type === "task.moved") {
    const from = event.payload.fromColumnId as string | undefined;
    const to = event.payload.toColumnId as string | undefined;
    if (trigger.fromColumnId && trigger.fromColumnId !== from) {
      return { matched: false, reason: `Venía de ${labels.column(from)}, no de ${labels.column(trigger.fromColumnId)}` };
    }
    if (trigger.toColumnId && trigger.toColumnId !== to) {
      return { matched: false, reason: `Se movió a ${labels.column(to)}, no a ${labels.column(trigger.toColumnId)}` };
    }
  }
  if (trigger.type === "task.due_soon") {
    const hours = event.payload.hoursBefore;
    if (typeof hours === "number" && hours !== trigger.hoursBefore) {
      return { matched: false, reason: "Corresponde a otra anticipación" };
    }
  }
  return { matched: true };
}

function evaluateCondition(c: Condition, task: TaskSnapshot, labels: Labels): ConditionResult {
  switch (c.type) {
    case "priority": {
      const inList = c.values.includes(task.priority);
      const list = c.values.map((p) => PRIORITY_META[p].label).join(", ");
      return {
        condition: c,
        passed: c.op === "in" ? inList : !inList,
        description: `Prioridad ${c.op === "in" ? "es" : "no es"} ${list}`,
        actual: PRIORITY_META[task.priority].label,
      };
    }
    case "tag": {
      const has = task.tagIds.includes(c.tagId);
      return {
        condition: c,
        passed: c.op === "has" ? has : !has,
        description: `${c.op === "has" ? "Tiene" : "No tiene"} el tag ${labels.tag(c.tagId)}`,
        actual: task.tagIds.length ? task.tagIds.map(labels.tag).join(", ") : "sin tags",
      };
    }
    case "epic": {
      const is = task.epicId === c.epicId;
      return {
        condition: c,
        passed: c.op === "is" ? is : !is,
        description: `Epic ${c.op === "is" ? "es" : "no es"} ${labels.epic(c.epicId)}`,
        actual: labels.epic(task.epicId),
      };
    }
    case "assignee": {
      const is = task.assigneeId === c.userId;
      return {
        condition: c,
        passed: c.op === "is" ? is : !is,
        description: `Responsable ${c.op === "is" ? "es" : "no es"} ${labels.user(c.userId)}`,
        actual: labels.user(task.assigneeId),
      };
    }
    case "column": {
      const is = task.columnId === c.columnId;
      return {
        condition: c,
        passed: c.op === "is" ? is : !is,
        description: `Columna ${c.op === "is" ? "es" : "no es"} ${labels.column(c.columnId)}`,
        actual: labels.column(task.columnId),
      };
    }
    case "is_subtask": {
      const isSub = task.parentId !== null;
      return {
        condition: c,
        passed: isSub === c.value,
        description: c.value ? "Es una subtarea" : "Es una tarea principal",
        actual: isSub ? "subtarea" : "tarea principal",
      };
    }
  }
}

export function evaluateConditions(conditions: Condition[], task: TaskSnapshot, labels: Labels = plainLabels) {
  const results = conditions.map((c) => evaluateCondition(c, task, labels));
  return { passed: results.every((r) => r.passed), results };
}

/** Decide si una regla se ejecuta para un evento, con una explicación legible. */
export function planRun(rule: EngineRule, event: EngineEvent, task: TaskSnapshot, labels: Labels = plainLabels): RunPlan {
  if (event.ruleChain.includes(rule.id)) {
    return { decision: "skip", reason: "Bucle evitado: esta regla ya actuó en la misma cadena", conditions: [] };
  }
  if (event.depth >= MAX_CHAIN_DEPTH) {
    return { decision: "skip", reason: `Límite de ${MAX_CHAIN_DEPTH} automatizaciones encadenadas alcanzado`, conditions: [] };
  }
  const trigger = triggerMatches(rule.trigger, event, labels);
  if (!trigger.matched) return { decision: "skip", reason: trigger.reason ?? "No coincide el disparador", conditions: [] };
  const { passed, results } = evaluateConditions(rule.conditions, task, labels);
  if (!passed) {
    const failed = results.filter((r) => !r.passed).map((r) => r.description);
    return { decision: "skip", reason: `No se cumple: ${failed.join("; ")}`, conditions: results };
  }
  return { decision: "run", conditions: results, actions: rule.actions };
}

/** Reemplaza {{variables}} en comentarios automáticos. Las desconocidas quedan vacías. */
export function renderTemplate(body: string, task: TaskSnapshot, payload: Record<string, unknown>) {
  const pr = (payload.pr ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {
    "task.key": `${task.projectKey}-${task.number}`,
    "task.title": task.title,
    "pr.number": pr.number != null ? String(pr.number) : "",
    "pr.title": String(pr.title ?? ""),
    "pr.url": String(pr.url ?? ""),
    branch: String(payload.branch ?? pr.branch ?? ""),
    repo: String(payload.repo ?? ""),
    due_date: task.dueDate ?? "",
  };
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}
