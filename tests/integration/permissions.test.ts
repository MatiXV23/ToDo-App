import { describe, expect, it } from "vitest";
import { getBoard } from "@/server/services/board";
import { addComment, deleteComment, updateComment } from "@/server/services/comments";
import { createColumn } from "@/server/services/columns";
import { createEpic } from "@/server/services/epics";
import {
  changeRole,
  inviteMember,
  listMembers,
  listMyInvitations,
  removeMember,
  respondInvitation,
} from "@/server/services/members";
import { listNotifications } from "@/server/services/notifications";
import { deleteProject, getProjectByKey, updateProject } from "@/server/services/projects";
import { createSprint } from "@/server/services/sprints";
import { createTag } from "@/server/services/tags";
import { createTask, deleteTask, getTaskDetail, moveTask, updateTask } from "@/server/services/tasks";
import { addMember, as, createTestProject, createUser, projectWithRoles } from "./helpers";

const NOT_FOUND = expect.objectContaining({ code: "NOT_FOUND" });
const FORBIDDEN = expect.objectContaining({ code: "FORBIDDEN" });
const BAD_REQUEST = expect.objectContaining({ code: "BAD_REQUEST" });

describe("acceso de alguien que no es miembro", () => {
  it("no puede ver ni tocar nada, y el proyecto parece no existir", async () => {
    const { project, outsider, owner } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "Secreta" });

    await expect(getBoard(as(outsider), project.id)).rejects.toEqual(NOT_FOUND);
    await expect(getProjectByKey(as(outsider), project.key)).rejects.toEqual(NOT_FOUND);
    await expect(getTaskDetail(as(outsider), task.id)).rejects.toEqual(NOT_FOUND);
    await expect(createTask(as(outsider), { projectId: project.id, title: "x" })).rejects.toEqual(NOT_FOUND);
    await expect(updateTask(as(outsider), { taskId: task.id, title: "x" })).rejects.toEqual(NOT_FOUND);
    await expect(addComment(as(outsider), { taskId: task.id, bodyMd: "hola" })).rejects.toEqual(NOT_FOUND);
    await expect(listMembers(as(outsider), project.id)).rejects.toEqual(NOT_FOUND);
  });
});

describe("rol solo lectura", () => {
  it("puede ver el tablero y las tareas", async () => {
    const { project, viewer, owner } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "Visible" });
    const board = await getBoard(as(viewer), project.id);
    expect(board.tasks.map((t) => t.id)).toContain(task.id);
    expect(board.project.role).toBe("viewer");
    expect((await getTaskDetail(as(viewer), task.id)).title).toBe("Visible");
  });

  it("no puede modificar nada", async () => {
    const { project, columns, viewer, owner } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "Intocable" });
    const v = as(viewer);

    await expect(createTask(v, { projectId: project.id, title: "x" })).rejects.toEqual(FORBIDDEN);
    await expect(updateTask(v, { taskId: task.id, title: "x" })).rejects.toEqual(FORBIDDEN);
    await expect(moveTask(v, { taskId: task.id, columnId: columns.done.id, afterTaskId: null })).rejects.toEqual(
      FORBIDDEN,
    );
    await expect(deleteTask(v, task.id)).rejects.toEqual(FORBIDDEN);
    await expect(addComment(v, { taskId: task.id, bodyMd: "hola" })).rejects.toEqual(FORBIDDEN);
    await expect(createTag(v, { projectId: project.id, name: "bug", color: "#ff0000" })).rejects.toEqual(FORBIDDEN);
    await expect(createEpic(v, { projectId: project.id, title: "Epic" })).rejects.toEqual(FORBIDDEN);
    await expect(createSprint(v, { projectId: project.id })).rejects.toEqual(FORBIDDEN);
    await expect(createColumn(v, { projectId: project.id, name: "QA", category: "in_progress" })).rejects.toEqual(
      FORBIDDEN,
    );
    await expect(inviteMember(v, { projectId: project.id, email: "a@b.com", role: "viewer" })).rejects.toEqual(
      FORBIDDEN,
    );

    const after = await getTaskDetail(as(owner), task.id);
    expect(after.title).toBe("Intocable");
    expect(after.columnId).toBe(columns.todo.id);
  });
});

describe("rol editor", () => {
  it("trabaja con tareas, comentarios, tags, epics, sprints y columnas", async () => {
    const { project, columns, editor } = await projectWithRoles();
    const e = as(editor);
    const task = await createTask(e, { projectId: project.id, title: "Del editor" });
    await updateTask(e, { taskId: task.id, priority: "high" });
    await moveTask(e, { taskId: task.id, columnId: columns.doing.id, afterTaskId: null });
    await addComment(e, { taskId: task.id, bodyMd: "Avanzando" });
    await createTag(e, { projectId: project.id, name: "frontend", color: "#3b82f6" });
    await createEpic(e, { projectId: project.id, title: "Onboarding" });
    await createSprint(e, { projectId: project.id });
    await createColumn(e, { projectId: project.id, name: "QA", category: "in_progress" });

    const detail = await getTaskDetail(e, task.id);
    expect(detail.priority).toBe("high");
    expect(detail.columnId).toBe(columns.doing.id);
    expect(detail.comments).toHaveLength(1);
  });

  it("no administra miembros ni la configuración del proyecto", async () => {
    const { project, editor, viewer } = await projectWithRoles();
    const e = as(editor);
    await expect(inviteMember(e, { projectId: project.id, email: "x@y.com", role: "viewer" })).rejects.toEqual(
      FORBIDDEN,
    );
    await expect(changeRole(e, { projectId: project.id, userId: viewer.id, role: "editor" })).rejects.toEqual(
      FORBIDDEN,
    );
    await expect(removeMember(e, { projectId: project.id, userId: viewer.id })).rejects.toEqual(FORBIDDEN);
    await expect(updateProject(e, { projectId: project.id, name: "Otro" })).rejects.toEqual(FORBIDDEN);
    await expect(deleteProject(e, project.id, project.key)).rejects.toEqual(FORBIDDEN);
  });

  it("no puede editar comentarios ajenos; el dueño puede borrarlos", async () => {
    const { project, owner, editor } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "T" });
    const editorComment = await addComment(as(editor), { taskId: task.id, bodyMd: "del editor" });
    const ownerComment = await addComment(as(owner), { taskId: task.id, bodyMd: "de la dueña" });

    await expect(updateComment(as(editor), { commentId: ownerComment.id, bodyMd: "hackeado" })).rejects.toEqual(
      FORBIDDEN,
    );
    await expect(deleteComment(as(editor), ownerComment.id)).rejects.toEqual(FORBIDDEN);
    await expect(updateComment(as(owner), { commentId: editorComment.id, bodyMd: "editado" })).rejects.toEqual(
      FORBIDDEN,
    );
    await deleteComment(as(owner), editorComment.id);
    const detail = await getTaskDetail(as(owner), task.id);
    expect(detail.comments.map((c) => c.bodyMd)).toEqual(["de la dueña"]);
  });
});

describe("invitaciones", () => {
  it("el invitado la ve en su buzón y al aceptarla obtiene el rol", async () => {
    const owner = await createUser("Dueña");
    const guest = await createUser("Invitado");
    const { project } = await createTestProject(owner);

    await inviteMember(as(owner), { projectId: project.id, email: guest.email.toUpperCase(), role: "editor" });
    const inbox = await listNotifications(guest.id);
    expect(inbox[0]).toMatchObject({ type: "invitation", project: { id: project.id } });
    const [invitation] = await listMyInvitations(guest.id);

    await expect(getBoard(as(guest), project.id)).rejects.toEqual(NOT_FOUND);
    await respondInvitation(as(guest), invitation.id, true);
    expect((await getBoard(as(guest), project.id)).project.role).toBe("editor");
    expect((await listNotifications(owner.id))[0]).toMatchObject({ type: "invitation_accepted" });
  });

  it("solo quien tiene el email invitado puede responderla", async () => {
    const owner = await createUser("Dueña");
    const guest = await createUser("Invitado");
    const intruder = await createUser("Intruso");
    const { project } = await createTestProject(owner);
    const invitation = await inviteMember(as(owner), { projectId: project.id, email: guest.email, role: "viewer" });

    await expect(respondInvitation(as(intruder), invitation.id, true)).rejects.toEqual(NOT_FOUND);
    await expect(getBoard(as(intruder), project.id)).rejects.toEqual(NOT_FOUND);
  });

  it("no se puede invitar como dueño ni duplicar invitaciones o miembros", async () => {
    const { project, owner, editor } = await projectWithRoles();
    await expect(
      inviteMember(as(owner), { projectId: project.id, email: "nuevo@test.local", role: "owner" as "editor" }),
    ).rejects.toBeTruthy();
    await inviteMember(as(owner), { projectId: project.id, email: "nuevo@test.local", role: "viewer" });
    await expect(
      inviteMember(as(owner), { projectId: project.id, email: "nuevo@test.local", role: "editor" }),
    ).rejects.toEqual(expect.objectContaining({ code: "CONFLICT" }));
    await expect(
      inviteMember(as(owner), { projectId: project.id, email: editor.email, role: "viewer" }),
    ).rejects.toEqual(expect.objectContaining({ code: "CONFLICT" }));
  });
});

describe("gestión de miembros", () => {
  it("el dueño no puede ser quitado ni degradado", async () => {
    const { project, owner } = await projectWithRoles();
    await expect(removeMember(as(owner), { projectId: project.id, userId: owner.id })).rejects.toEqual(BAD_REQUEST);
    await expect(
      changeRole(as(owner), { projectId: project.id, userId: owner.id, role: "viewer" }),
    ).rejects.toEqual(BAD_REQUEST);
  });

  it("un miembro quitado pierde el acceso y sus tareas quedan sin responsable", async () => {
    const { project, owner, editor } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "Asignada", assigneeId: editor.id });
    await removeMember(as(owner), { projectId: project.id, userId: editor.id });
    await expect(getBoard(as(editor), project.id)).rejects.toEqual(NOT_FOUND);
    expect((await getTaskDetail(as(owner), task.id)).assigneeId).toBeNull();
  });

  it("cualquier miembro puede salir del proyecto", async () => {
    const { project, viewer } = await projectWithRoles();
    await removeMember(as(viewer), { projectId: project.id, userId: viewer.id });
    await expect(getBoard(as(viewer), project.id)).rejects.toEqual(NOT_FOUND);
  });

  it("cambiar el rol cambia los permisos efectivos", async () => {
    const { project, owner, viewer } = await projectWithRoles();
    await expect(createTask(as(viewer), { projectId: project.id, title: "x" })).rejects.toEqual(FORBIDDEN);
    await changeRole(as(owner), { projectId: project.id, userId: viewer.id, role: "editor" });
    await expect(createTask(as(viewer), { projectId: project.id, title: "Ahora sí" })).resolves.toBeTruthy();
  });
});

describe("aislamiento entre proyectos", () => {
  it("no se pueden usar columnas, tags, epics ni responsables de otro proyecto", async () => {
    const owner = await createUser("Dueña");
    const stranger = await createUser("Ajeno");
    const a = await createTestProject(owner);
    const b = await createTestProject(owner);
    const tagB = await createTag(as(owner), { projectId: b.project.id, name: "de-b", color: "#00ff00" });
    const epicB = await createEpic(as(owner), { projectId: b.project.id, title: "Epic B" });
    const task = await createTask(as(owner), { projectId: a.project.id, title: "En A" });

    await expect(
      createTask(as(owner), { projectId: a.project.id, title: "x", columnId: b.columns.todo.id }),
    ).rejects.toEqual(BAD_REQUEST);
    await expect(updateTask(as(owner), { taskId: task.id, tagIds: [tagB.id] })).rejects.toEqual(BAD_REQUEST);
    await expect(updateTask(as(owner), { taskId: task.id, epicId: epicB.id })).rejects.toEqual(BAD_REQUEST);
    await expect(updateTask(as(owner), { taskId: task.id, assigneeId: stranger.id })).rejects.toEqual(BAD_REQUEST);
    await expect(
      moveTask(as(owner), { taskId: task.id, columnId: b.columns.done.id, afterTaskId: null }),
    ).rejects.toEqual(BAD_REQUEST);
  });

  it("ser miembro de un proyecto no da acceso a otro del mismo dueño", async () => {
    const owner = await createUser("Dueña");
    const member = await createUser("Miembro");
    const a = await createTestProject(owner);
    const b = await createTestProject(owner);
    await addMember(a.project.id, member, "editor");
    await expect(getBoard(as(member), b.project.id)).rejects.toEqual(NOT_FOUND);
  });
});
