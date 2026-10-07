import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { taskActivity } from "@/server/db/schema";
import { getBoard } from "@/server/services/board";
import { createColumn, deleteColumn, updateColumn } from "@/server/services/columns";
import { createTag } from "@/server/services/tags";
import { createTask, moveTask, updateTask } from "@/server/services/tasks";
import { as, createTestProject, createUser } from "./helpers";

async function setup() {
  const owner = await createUser("Dueña");
  const { project, columns } = await createTestProject(owner);
  const ia = await createTag(as(owner), { projectId: project.id, name: "IA", color: "#a855f7" });
  const ui = await createTag(as(owner), { projectId: project.id, name: "ui", color: "#3b82f6" });
  const iaColumn = await createColumn(as(owner), {
    projectId: project.id,
    name: "IA",
    category: "todo",
    autoTagIds: [ia.id],
  });
  const tagsOf = async (taskId: string) =>
    (await getBoard(as(owner), project.id)).tasks.find((t) => t.id === taskId)?.tagIds.sort();
  return { owner, project, columns, ia, ui, iaColumn, tagsOf };
}

describe("tags automáticos de columna", () => {
  it("las tareas creadas en la columna reciben el tag, además de los elegidos", async () => {
    const { owner, project, ia, ui, iaColumn, tagsOf } = await setup();
    const task = await createTask(as(owner), { projectId: project.id, title: "Hacé esto", columnId: iaColumn.id, tagIds: [ui.id] });
    expect(await tagsOf(task.id)).toEqual([ia.id, ui.id].sort());
    const board = await getBoard(as(owner), project.id);
    expect(board.columns.find((c) => c.id === iaColumn.id)?.autoTagIds).toEqual([ia.id]);
  });

  it("al mover una tarea a la columna recibe el tag, y al sacarla lo conserva", async () => {
    const { owner, project, columns, ia, iaColumn, tagsOf } = await setup();
    const task = await createTask(as(owner), { projectId: project.id, title: "Mover" });
    expect(await tagsOf(task.id)).toEqual([]);

    await moveTask(as(owner), { taskId: task.id, columnId: iaColumn.id, afterTaskId: null });
    expect(await tagsOf(task.id)).toEqual([ia.id]);
    const history = await db.select().from(taskActivity).where(eq(taskActivity.taskId, task.id));
    expect(history.find((h) => h.field === "tags")).toMatchObject({ oldValue: [], newValue: ["IA"] });

    await moveTask(as(owner), { taskId: task.id, columnId: columns.doing.id, afterTaskId: null });
    expect(await tagsOf(task.id)).toEqual([ia.id]);

    // Por el campo columna del detalle también.
    const other = await createTask(as(owner), { projectId: project.id, title: "Otra" });
    await updateTask(as(owner), { taskId: other.id, columnId: iaColumn.id });
    expect(await tagsOf(other.id)).toEqual([ia.id]);
  });

  it("al configurar la columna, las tareas que ya estaban reciben los tags nuevos", async () => {
    const { owner, project, columns, ia, ui, tagsOf } = await setup();
    const a = await createTask(as(owner), { projectId: project.id, title: "A", columnId: columns.review.id });
    const b = await createTask(as(owner), { projectId: project.id, title: "B", columnId: columns.review.id, tagIds: [ui.id] });
    await updateColumn(as(owner), { columnId: columns.review.id, autoTagIds: [ia.id, ui.id] });
    expect(await tagsOf(a.id)).toEqual([ia.id, ui.id].sort());
    expect(await tagsOf(b.id)).toEqual([ia.id, ui.id].sort());

    // Quitar tags automáticos no se los saca a las tareas.
    await updateColumn(as(owner), { columnId: columns.review.id, autoTagIds: [] });
    expect(await tagsOf(a.id)).toEqual([ia.id, ui.id].sort());
    const board = await getBoard(as(owner), project.id);
    expect(board.columns.find((c) => c.id === columns.review.id)?.autoTagIds).toEqual([]);
  });

  it("al borrar una columna, sus tareas reciben los tags de la columna destino", async () => {
    const { owner, project, columns, ia, iaColumn, tagsOf } = await setup();
    const task = await createTask(as(owner), { projectId: project.id, title: "X", columnId: columns.review.id });
    await deleteColumn(as(owner), { columnId: columns.review.id, moveTasksTo: iaColumn.id });
    expect(await tagsOf(task.id)).toEqual([ia.id]);
  });

  it("aguanta cambios simultáneos sobre la misma columna", async () => {
    const { owner, project, ia, ui, iaColumn } = await setup();
    await Promise.all([
      updateColumn(as(owner), { columnId: iaColumn.id, autoTagIds: [ia.id, ui.id] }),
      updateColumn(as(owner), { columnId: iaColumn.id, autoTagIds: [ia.id] }),
      updateColumn(as(owner), { columnId: iaColumn.id, autoTagIds: [ui.id] }),
    ]);
    const board = await getBoard(as(owner), project.id);
    expect(board.columns.find((c) => c.id === iaColumn.id)?.autoTagIds.length).toBeGreaterThan(0);
  });

  it("rechaza tags de otro proyecto y respeta los permisos", async () => {
    const { owner, columns } = await setup();
    const stranger = await createUser("Ajena");
    const other = await createTestProject(stranger);
    const foreign = await createTag(as(stranger), { projectId: other.project.id, name: "IA", color: "#a855f7" });
    await expect(updateColumn(as(owner), { columnId: columns.todo.id, autoTagIds: [foreign.id] })).rejects.toThrow(
      /Tag inválido/,
    );
    await expect(updateColumn(as(stranger), { columnId: columns.todo.id, autoTagIds: [] })).rejects.toThrow();
  });
});
