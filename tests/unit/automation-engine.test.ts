import { describe, expect, it } from "vitest";
import { ruleInputSchema } from "@/lib/automation-schema";
import {
  type EngineEvent,
  type EngineRule,
  evaluateConditions,
  MAX_CHAIN_DEPTH,
  planRun,
  renderTemplate,
  type TaskSnapshot,
  triggerMatches,
} from "@/server/automations/engine";

const COL = { todo: "00000000-0000-4000-8000-000000000001", doing: "00000000-0000-4000-8000-000000000002", review: "00000000-0000-4000-8000-000000000003", done: "00000000-0000-4000-8000-000000000004" };
const TAG = { bug: "00000000-0000-4000-8000-0000000000b1", urgent: "00000000-0000-4000-8000-0000000000b2" };
const EPIC = "00000000-0000-4000-8000-0000000000e1";

const task = (over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  id: "t1",
  number: 12,
  title: "Arreglar login",
  projectKey: "TDA",
  columnId: COL.doing,
  priority: "medium",
  epicId: null,
  assigneeId: null,
  parentId: null,
  dueDate: null,
  tagIds: [],
  ...over,
});

const event = (over: Partial<EngineEvent> = {}): EngineEvent => ({
  type: "pr.opened",
  taskId: "t1",
  payload: {},
  depth: 0,
  ruleChain: [],
  ...over,
});

const rule = (over: Partial<EngineRule> = {}): EngineRule => ({
  id: "r1",
  name: "PR abierto → En revisión",
  trigger: { type: "pr.opened" },
  conditions: [],
  actions: [{ type: "move_to_column", columnId: COL.review }],
  ...over,
});

describe("disparadores", () => {
  it("solo coinciden con su tipo de evento", () => {
    expect(triggerMatches({ type: "pr.opened" }, event()).matched).toBe(true);
    expect(triggerMatches({ type: "pr.merged" }, event()).matched).toBe(false);
  });

  it("tarea movida filtra por columna de origen y destino", () => {
    const moved = event({ type: "task.moved", payload: { fromColumnId: COL.doing, toColumnId: COL.done } });
    expect(triggerMatches({ type: "task.moved" }, moved).matched).toBe(true);
    expect(triggerMatches({ type: "task.moved", toColumnId: COL.done }, moved).matched).toBe(true);
    expect(triggerMatches({ type: "task.moved", fromColumnId: COL.doing, toColumnId: COL.done }, moved).matched).toBe(true);
    expect(triggerMatches({ type: "task.moved", toColumnId: COL.review }, moved)).toMatchObject({ matched: false });
    expect(triggerMatches({ type: "task.moved", fromColumnId: COL.todo }, moved)).toMatchObject({ matched: false });
  });

  it("fecha límite próxima respeta la anticipación de cada regla", () => {
    const due = event({ type: "task.due_soon", payload: { hoursBefore: 24 } });
    expect(triggerMatches({ type: "task.due_soon", hoursBefore: 24 }, due).matched).toBe(true);
    expect(triggerMatches({ type: "task.due_soon", hoursBefore: 48 }, due).matched).toBe(false);
  });
});

describe("condiciones", () => {
  it("sin condiciones siempre se cumple", () => {
    expect(evaluateConditions([], task()).passed).toBe(true);
  });

  it("prioridad (en / no en)", () => {
    const high = task({ priority: "high" });
    expect(evaluateConditions([{ type: "priority", op: "in", values: ["high", "urgent"] }], high).passed).toBe(true);
    expect(evaluateConditions([{ type: "priority", op: "not_in", values: ["high"] }], high).passed).toBe(false);
  });

  it("tags (tiene / no tiene)", () => {
    const tagged = task({ tagIds: [TAG.bug] });
    expect(evaluateConditions([{ type: "tag", op: "has", tagId: TAG.bug }], tagged).passed).toBe(true);
    expect(evaluateConditions([{ type: "tag", op: "has", tagId: TAG.urgent }], tagged).passed).toBe(false);
    expect(evaluateConditions([{ type: "tag", op: "not_has", tagId: TAG.urgent }], tagged).passed).toBe(true);
  });

  it("epic, responsable, columna y tipo (incluye valores vacíos)", () => {
    const t = task({ epicId: EPIC, assigneeId: "u1", parentId: "p1" });
    expect(evaluateConditions([{ type: "epic", op: "is", epicId: EPIC }], t).passed).toBe(true);
    expect(evaluateConditions([{ type: "epic", op: "is", epicId: null }], task()).passed).toBe(true);
    expect(evaluateConditions([{ type: "assignee", op: "is", userId: null }], t).passed).toBe(false);
    expect(evaluateConditions([{ type: "assignee", op: "is_not", userId: "u2" }], t).passed).toBe(true);
    expect(evaluateConditions([{ type: "column", op: "is", columnId: COL.doing }], t).passed).toBe(true);
    expect(evaluateConditions([{ type: "column", op: "is_not", columnId: COL.doing }], t).passed).toBe(false);
    expect(evaluateConditions([{ type: "is_subtask", value: true }], t).passed).toBe(true);
    expect(evaluateConditions([{ type: "is_subtask", value: true }], task()).passed).toBe(false);
  });

  it("todas tienen que cumplirse (Y lógico) y cada una queda explicada", () => {
    const { passed, results } = evaluateConditions(
      [
        { type: "priority", op: "in", values: ["medium"] },
        { type: "tag", op: "has", tagId: TAG.bug },
      ],
      task(),
    );
    expect(passed).toBe(false);
    expect(results.map((r) => r.passed)).toEqual([true, false]);
    expect(results[0]).toMatchObject({ description: "Prioridad es Media", actual: "Media" });
  });
});

describe("plan de ejecución", () => {
  it("ejecuta cuando coincide el disparador y se cumplen las condiciones", () => {
    const plan = planRun(rule(), event(), task());
    expect(plan.decision).toBe("run");
    if (plan.decision === "run") expect(plan.actions).toEqual([{ type: "move_to_column", columnId: COL.review }]);
  });

  it("omite con un motivo legible cuando no se cumplen las condiciones", () => {
    const plan = planRun(rule({ conditions: [{ type: "priority", op: "in", values: ["urgent"] }] }), event(), task());
    expect(plan).toMatchObject({ decision: "skip", reason: "No se cumple: Prioridad es Urgente" });
  });

  it("corta bucles: una regla no actúa dos veces en la misma cadena", () => {
    const plan = planRun(rule(), event({ ruleChain: ["r1"], depth: 1 }), task());
    expect(plan.decision).toBe("skip");
    if (plan.decision === "skip") expect(plan.reason).toMatch(/Bucle evitado/);
  });

  it("corta cadenas demasiado largas aunque las reglas sean distintas", () => {
    const plan = planRun(rule(), event({ depth: MAX_CHAIN_DEPTH, ruleChain: ["a", "b", "c"] }), task());
    expect(plan.decision).toBe("skip");
    if (plan.decision === "skip") expect(plan.reason).toMatch(/Límite/);
  });

  it("permite encadenar reglas distintas por debajo del límite", () => {
    expect(planRun(rule(), event({ depth: 1, ruleChain: ["otra"] }), task()).decision).toBe("run");
  });
});

describe("plantillas de comentarios", () => {
  it("reemplaza variables y deja vacías las desconocidas", () => {
    const text = renderTemplate("{{task.key}}: PR #{{pr.number}} {{pr.url}} en {{ repo }} {{nada}}", task(), {
      pr: { number: 7, url: "https://github.com/x/y/pull/7" },
      repo: "x/y",
    });
    expect(text).toBe("TDA-12: PR #7 https://github.com/x/y/pull/7 en x/y ");
  });
});

describe("validación de reglas", () => {
  it("exige al menos una acción y datos completos", () => {
    expect(ruleInputSchema.safeParse({ name: "x", trigger: { type: "pr.opened" }, actions: [] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ name: "x", trigger: { type: "task.due_soon" }, actions: [{ type: "add_comment", body: "hola" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ name: "", trigger: { type: "pr.opened" }, actions: [{ type: "add_comment", body: "hola" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ name: "ok", trigger: { type: "task.due_soon", hoursBefore: 24 }, actions: [{ type: "add_comment", body: "Vence {{due_date}}" }] }).success).toBe(true);
  });
});
