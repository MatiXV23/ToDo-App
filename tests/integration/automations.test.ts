import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { automationRuns, tasks } from "@/server/db/schema";
import { handleDomainEvent } from "@/server/automations/executor";
import { processPendingEvents } from "@/server/worker/events";
import { runDueSoonRules, notifyDueSoon } from "@/server/worker/scheduler";
import { createRule, listRuns, setRuleEnabled } from "@/server/services/automations";
import { deleteColumn } from "@/server/services/columns";
import { listNotifications } from "@/server/services/notifications";
import { createTag } from "@/server/services/tags";
import { createTask, getTaskDetail, moveTask } from "@/server/services/tasks";
import { pullRequestPayload, reviewPayload } from "../fixtures/github";
import { connectTestRepo, deliver } from "./github-helpers";
import { as, createTestProject, createUser, projectWithRoles } from "./helpers";

/** Procesa el outbox como lo hace el worker (incluye eventos encadenados). */
const drain = () => processPendingEvents(handleDomainEvent);
const columnOf = async (taskId: string) => (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0].columnId;

describe("ejemplo pedido: PR abierto → En revisión, PR mergeado → Hecho", () => {
  it("mueve la tarea siguiendo el ciclo del PR y deja registro de cada ejecución", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner, "AUT");
    await connectTestRepo(project.id);
    await createRule(as(owner), {
      projectId: project.id,
      name: "PR abierto → En revisión",
      trigger: { type: "pr.opened" },
      actions: [{ type: "move_to_column", columnId: columns.review.id }],
    });
    await createRule(as(owner), {
      projectId: project.id,
      name: "PR mergeado → Hecho",
      trigger: { type: "pr.merged" },
      actions: [
        { type: "move_to_column", columnId: columns.done.id },
        { type: "add_comment", body: "Mergeado en {{pr.url}} ✅" },
      ],
    });
    const task = await createTask(as(owner), { projectId: project.id, title: "Login con Google", columnId: columns.doing.id });

    await deliver("pull_request", pullRequestPayload("opened", { title: "AUT-1 login" }));
    await drain();
    expect(await columnOf(task.id)).toBe(columns.review.id);

    await deliver("pull_request_review", reviewPayload({ title: "AUT-1 login" }));
    await drain();
    expect(await columnOf(task.id)).toBe(columns.review.id);

    await deliver("pull_request", pullRequestPayload("closed", { title: "AUT-1 login", state: "closed", merged: true }));
    await drain();
    const detail = await getTaskDetail(as(owner), task.id);
    expect(detail.columnId).toBe(columns.done.id);
    expect(detail.completedAt).not.toBeNull();
    expect(detail.comments.at(-1)).toMatchObject({ source: "automation", bodyMd: "Mergeado en https://github.com/matix/todoapp/pull/7 ✅" });
    expect(detail.activity.filter((a) => a.actorType === "automation" && a.kind === "moved")).toHaveLength(2);

    const runs = await listRuns(as(owner), { projectId: project.id });
    const successful = runs.filter((r) => r.status === "success").map((r) => r.ruleName).sort();
    expect(successful).toEqual(["PR abierto → En revisión", "PR mergeado → Hecho"]);
    const merged = runs.find((r) => r.ruleName === "PR mergeado → Hecho")!;
    expect(merged.details).toMatchObject({
      actions: [
        { type: "move_to_column", ok: true, changed: true, message: "Movida a Hecho" },
        { type: "add_comment", ok: true },
      ],
    });
  });
});

describe("motor de automatizaciones contra la base", () => {
  it("registra el motivo cuando no se cumplen las condiciones y no toca la tarea", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    await createRule(as(owner), {
      projectId: project.id,
      name: "Urgentes a En curso",
      trigger: { type: "task.created" },
      conditions: [{ type: "priority", op: "in", values: ["urgent"] }],
      actions: [{ type: "move_to_column", columnId: columns.doing.id }],
    });
    const normal = await createTask(as(owner), { projectId: project.id, title: "Normal" });
    const urgent = await createTask(as(owner), { projectId: project.id, title: "Urgente", priority: "urgent" });
    await drain();

    expect(await columnOf(normal.id)).toBe(columns.todo.id);
    expect(await columnOf(urgent.id)).toBe(columns.doing.id);
    const runs = await listRuns(as(owner), { projectId: project.id });
    const skipped = runs.find((r) => r.task?.id === normal.id)!;
    expect(skipped).toMatchObject({ status: "skipped", reason: "No se cumple: Prioridad es Urgente" });
    expect(skipped.details).toMatchObject({ conditions: [{ description: "Prioridad es Urgente", actual: "Media", passed: false }] });
  });

  it("aplica asignar, agregar y quitar tags y comentar al crear una tarea", async () => {
    const { project, owner, editor } = await projectWithRoles();
    const bug = await createTag(as(owner), { projectId: project.id, name: "bug", color: "#ff0000" });
    const triage = await createTag(as(owner), { projectId: project.id, name: "triage", color: "#00ff00" });
    await createRule(as(owner), {
      projectId: project.id,
      name: "Triage de bugs",
      trigger: { type: "task.created" },
      conditions: [{ type: "tag", op: "has", tagId: bug.id }],
      actions: [
        { type: "assign", userId: editor.id },
        { type: "add_tag", tagId: triage.id },
        { type: "remove_tag", tagId: bug.id },
        { type: "add_comment", body: "{{task.key}} quedó en triage" },
      ],
    });
    const task = await createTask(as(owner), { projectId: project.id, title: "Se cae", tagIds: [bug.id] });
    await drain();
    const detail = await getTaskDetail(as(owner), task.id);
    expect(detail.assigneeId).toBe(editor.id);
    expect(detail.tags.map((t) => t.name)).toEqual(["triage"]);
    expect(detail.comments[0].bodyMd).toBe(`${project.key}-1 quedó en triage`);
    // La asignación por automatización también avisa al responsable.
    expect((await listNotifications(editor.id)).some((n) => n.type === "assigned")).toBe(true);
  });

  it("filtra 'tarea movida' por columna destino y encadena reglas distintas", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    const done = await createTag(as(owner), { projectId: project.id, name: "cerrada", color: "#000000" });
    await createRule(as(owner), {
      projectId: project.id,
      name: "En revisión → Hecho",
      trigger: { type: "task.moved", toColumnId: columns.review.id },
      actions: [{ type: "move_to_column", columnId: columns.done.id }],
    });
    await createRule(as(owner), {
      projectId: project.id,
      name: "Al terminar, etiquetar",
      trigger: { type: "task.moved", toColumnId: columns.done.id },
      actions: [{ type: "add_tag", tagId: done.id }],
    });
    const task = await createTask(as(owner), { projectId: project.id, title: "Encadenada" });
    await moveTask(as(owner), { taskId: task.id, columnId: columns.review.id, afterTaskId: null });
    await drain();

    const detail = await getTaskDetail(as(owner), task.id);
    expect(detail.columnId).toBe(columns.done.id);
    expect(detail.tags.map((t) => t.name)).toEqual(["cerrada"]);
    const runs = await db.select().from(automationRuns).where(eq(automationRuns.status, "success"));
    expect(runs.map((r) => r.depth).sort()).toEqual([0, 1]);
  });

  it("corta bucles entre reglas que se disparan mutuamente", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    await createRule(as(owner), {
      projectId: project.id,
      name: "A: En curso → En revisión",
      trigger: { type: "task.moved", toColumnId: columns.doing.id },
      actions: [{ type: "move_to_column", columnId: columns.review.id }],
    });
    await createRule(as(owner), {
      projectId: project.id,
      name: "B: En revisión → En curso",
      trigger: { type: "task.moved", toColumnId: columns.review.id },
      actions: [{ type: "move_to_column", columnId: columns.doing.id }],
    });
    const task = await createTask(as(owner), { projectId: project.id, title: "Ping-pong" });
    await moveTask(as(owner), { taskId: task.id, columnId: columns.doing.id, afterTaskId: null });
    await drain();

    const runs = await db.select().from(automationRuns);
    // A mueve a revisión, B devuelve a curso, A ya actuó en la cadena: se corta.
    expect(runs.filter((r) => r.status === "success")).toHaveLength(2);
    expect(runs.some((r) => r.status === "skipped" && r.reason?.startsWith("Bucle evitado"))).toBe(true);
    expect(runs.length).toBeLessThan(10);
    expect(await columnOf(task.id)).toBe(columns.doing.id);
  });

  it("registra fallos de acciones (columna borrada) sin frenar las demás", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    await createRule(as(owner), {
      projectId: project.id,
      name: "A una columna que se va a borrar",
      trigger: { type: "task.created" },
      actions: [
        { type: "move_to_column", columnId: columns.review.id },
        { type: "add_comment", body: "Igual comento" },
      ],
    });
    await deleteColumn(as(owner), { columnId: columns.review.id, moveTasksTo: columns.doing.id });
    const task = await createTask(as(owner), { projectId: project.id, title: "Huérfana" });
    await drain();

    const [run] = await db.select().from(automationRuns);
    expect(run.status).toBe("failed");
    expect(run.details).toMatchObject({ actions: [{ ok: false }, { ok: true }] });
    expect((await getTaskDetail(as(owner), task.id)).comments).toHaveLength(1);
  });

  it("las reglas desactivadas no se ejecutan", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    const rule = await createRule(as(owner), {
      projectId: project.id,
      name: "Apagada",
      trigger: { type: "task.created" },
      actions: [{ type: "move_to_column", columnId: columns.done.id }],
    });
    await setRuleEnabled(as(owner), rule.id, false);
    const task = await createTask(as(owner), { projectId: project.id, title: "Quieta" });
    await drain();
    expect(await columnOf(task.id)).toBe(columns.todo.id);
    expect(await db.select().from(automationRuns)).toHaveLength(0);
  });

  it("cada evento se procesa una sola vez aunque se drene de nuevo", async () => {
    const owner = await createUser("Dueña");
    const { project } = await createTestProject(owner);
    await createRule(as(owner), {
      projectId: project.id,
      name: "Comentar",
      trigger: { type: "task.created" },
      actions: [{ type: "add_comment", body: "hola" }],
    });
    const task = await createTask(as(owner), { projectId: project.id, title: "Una vez" });
    await drain();
    await drain();
    expect((await getTaskDetail(as(owner), task.id)).comments).toHaveLength(1);
  });
});

describe("fecha límite próxima", () => {
  it("dispara una sola vez por fecha dentro de la ventana configurada", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    await createRule(as(owner), {
      projectId: project.id,
      name: "Vence pronto",
      trigger: { type: "task.due_soon", hoursBefore: 48 },
      actions: [
        { type: "move_to_column", columnId: columns.doing.id },
        { type: "add_comment", body: "Vence el {{due_date}}" },
      ],
    });
    const today = (await db.execute<{ d: string }>(sql`select (now() at time zone 'UTC')::date::text as d`)).rows[0].d;
    const soon = await createTask(as(owner), { projectId: project.id, title: "Vence hoy", dueDate: today, assigneeId: owner.id });
    const later = await createTask(as(owner), { projectId: project.id, title: "Vence en un mes", dueDate: "2099-01-01" });
    process.env.APP_TIMEZONE = "UTC";

    await runDueSoonRules();
    await runDueSoonRules();
    await notifyDueSoon();

    expect(await columnOf(soon.id)).toBe(columns.doing.id);
    expect(await columnOf(later.id)).toBe(columns.todo.id);
    expect((await getTaskDetail(as(owner), soon.id)).comments.map((c) => c.bodyMd)).toEqual([`Vence el ${today}`]);
    const runs = await db.select().from(automationRuns);
    expect(runs).toHaveLength(1);
    // Además, el responsable recibe el aviso en su buzón.
    expect((await listNotifications(owner.id)).some((n) => n.type === "due_soon")).toBe(true);
  });
});

describe("permisos sobre automatizaciones", () => {
  it("lectura no puede crear reglas; editor sí; no se aceptan referencias de otro proyecto", async () => {
    const { project, columns, viewer, editor, owner } = await projectWithRoles();
    const other = await createTestProject(owner);
    const base = { projectId: project.id, name: "x", trigger: { type: "task.created" as const } };

    await expect(
      createRule(as(viewer), { ...base, actions: [{ type: "move_to_column", columnId: columns.done.id }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createRule(as(editor), { ...base, actions: [{ type: "move_to_column", columnId: columns.done.id }] }),
    ).resolves.toBeTruthy();
    await expect(
      createRule(as(editor), { ...base, actions: [{ type: "move_to_column", columnId: other.columns.done.id }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(listRuns(as(viewer), { projectId: project.id })).resolves.toEqual([]);
  });
});
