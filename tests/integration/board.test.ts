import { describe, expect, it } from "vitest";
import { getBoard } from "@/server/services/board";
import { addComment } from "@/server/services/comments";
import { createSprint, getBacklog, moveInBacklog, startSprint, completeSprint } from "@/server/services/sprints";
import { updateProject } from "@/server/services/projects";
import { createTag } from "@/server/services/tags";
import { createTask, deleteTask, moveTask, restoreTask, updateTask } from "@/server/services/tasks";
import { pullRequestPayload } from "../fixtures/github";
import { connectTestRepo, deliver } from "./github-helpers";
import { as, createTestProject, createUser } from "./helpers";

describe("datos del tablero", () => {
  it("calcula subtareas, comentarios, tags y estado del PR por tarea", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner, "BRD");
    await connectTestRepo(project.id);
    const tag = await createTag(as(owner), { projectId: project.id, name: "ui", color: "#123456" });
    const parent = await createTask(as(owner), { projectId: project.id, title: "Padre", tagIds: [tag.id] });
    const sub1 = await createTask(as(owner), { projectId: project.id, title: "Sub 1", parentId: parent.id });
    await createTask(as(owner), { projectId: project.id, title: "Sub 2", parentId: parent.id });
    await moveTask(as(owner), { taskId: sub1.id, columnId: columns.done.id, afterTaskId: null });
    await addComment(as(owner), { taskId: parent.id, bodyMd: "uno" });
    await addComment(as(owner), { taskId: parent.id, bodyMd: "dos" });
    await deliver("pull_request", pullRequestPayload("opened", { title: "BRD-1 cambios", reviewers: 1 }));

    const board = await getBoard(as(owner), project.id);
    const card = board.tasks.find((t) => t.id === parent.id)!;
    expect(card).toMatchObject({ subtaskTotal: 2, subtaskDone: 1, commentCount: 2, tagIds: [tag.id], prState: "in_review" });
    expect(board.tasks.find((t) => t.id === sub1.id)).toMatchObject({ subtaskTotal: 0, commentCount: 0, prState: null });
  });

  it("ordena por posición, marca terminadas y respeta el borrado con deshacer", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    const a = await createTask(as(owner), { projectId: project.id, title: "A" });
    const b = await createTask(as(owner), { projectId: project.id, title: "B" });
    const c = await createTask(as(owner), { projectId: project.id, title: "C" });
    // C arriba de todo, luego A entre C y B.
    await moveTask(as(owner), { taskId: c.id, columnId: columns.todo.id, afterTaskId: null });
    await moveTask(as(owner), { taskId: b.id, columnId: columns.todo.id, afterTaskId: a.id });
    let order = (await getBoard(as(owner), project.id)).tasks.map((t) => t.title);
    expect(order).toEqual(["C", "A", "B"]);

    await updateTask(as(owner), { taskId: a.id, columnId: columns.done.id });
    let board = await getBoard(as(owner), project.id);
    expect(board.tasks.find((t) => t.id === a.id)?.completedAt).not.toBeNull();

    await deleteTask(as(owner), b.id);
    board = await getBoard(as(owner), project.id);
    expect(board.tasks.map((t) => t.title).sort()).toEqual(["A", "C"]);
    await restoreTask(as(owner), b.id);
    order = (await getBoard(as(owner), project.id)).tasks.map((t) => t.title).sort();
    expect(order).toEqual(["A", "B", "C"]);
  });
});

describe("sprints", () => {
  it("el tablero muestra solo el sprint activo y al cerrarlo lo pendiente vuelve al backlog", async () => {
    const owner = await createUser("Dueña");
    const { project, columns } = await createTestProject(owner);
    await updateProject(as(owner), { projectId: project.id, sprintsEnabled: true });
    const sprint = await createSprint(as(owner), { projectId: project.id });
    const done = await createTask(as(owner), { projectId: project.id, title: "Terminada" });
    const pending = await createTask(as(owner), { projectId: project.id, title: "Pendiente" });
    const backlogOnly = await createTask(as(owner), { projectId: project.id, title: "Backlog" });
    const sub = await createTask(as(owner), { projectId: project.id, title: "Sub", parentId: pending.id });
    await moveInBacklog(as(owner), { taskId: done.id, sprintId: sprint.id, afterTaskId: null });
    await moveInBacklog(as(owner), { taskId: pending.id, sprintId: sprint.id, afterTaskId: done.id });

    expect((await getBoard(as(owner), project.id)).tasks).toHaveLength(0);
    await startSprint(as(owner), { sprintId: sprint.id });
    const board = await getBoard(as(owner), project.id);
    expect(board.tasks.map((t) => t.title).sort()).toEqual(["Pendiente", "Sub", "Terminada"]);
    expect(board.tasks.some((t) => t.id === backlogOnly.id)).toBe(false);

    const backlog = await getBacklog(as(owner), project.id);
    expect(backlog.tasks.find((t) => t.id === pending.id)?.subtaskCount).toBe(1);

    await moveTask(as(owner), { taskId: done.id, columnId: columns.done.id, afterTaskId: null });
    const result = await completeSprint(as(owner), { sprintId: sprint.id, moveOpenTasksTo: null });
    expect(result.movedTasks).toBe(2); // la pendiente y su subtarea
    const after = await getBacklog(as(owner), project.id);
    expect(after.sprints).toHaveLength(0);
    expect(after.tasks.map((t) => t.title).sort()).toEqual(["Backlog", "Pendiente"]);
    expect(sub.parentId).toBe(pending.id);
  });

  it("no permite dos sprints activos", async () => {
    const owner = await createUser("Dueña");
    const { project } = await createTestProject(owner);
    const s1 = await createSprint(as(owner), { projectId: project.id });
    const s2 = await createSprint(as(owner), { projectId: project.id });
    await startSprint(as(owner), { sprintId: s1.id });
    await expect(startSprint(as(owner), { sprintId: s2.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
