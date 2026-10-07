import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";
import type { Actor } from "@/server/permissions/access";
import { createApiToken, setApiTokenExternal } from "@/server/services/api-tokens";
import { addAttachment } from "@/server/services/attachments";
import { addComment } from "@/server/services/comments";
import { setTaskApproval } from "@/server/services/review";
import { createTask, findTaskId, getTaskDetail, updateTask } from "@/server/services/tasks";
import { as, projectWithRoles } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "todoapp-review-"));
  process.env.UPLOADS_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const external = (userId: string): Actor => ({ type: "user", userId, via: "ITP App", external: true });

/** Una sola llamada `tools/call`, como la haría una integración sin SDK de MCP. */
async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  return { status: res.status, isError: !!body.result.isError, data: JSON.parse(body.result.content[0].text) };
}

describe("aprobación de tareas externas", () => {
  it("lo que crea un token externo queda pendiente; lo de un token normal, no", async () => {
    const { project, owner } = await projectWithRoles();
    const itp = await createApiToken(owner.id, { name: "ITP App", external: true });
    const claude = await createApiToken(owner.id, { name: "Claude" });

    const fromItp = await callTool(itp.token, "create_task", {
      project: project.key,
      title: "Error al guardar el perfil",
      column: "Por hacer",
      tags: ["ITP App"],
    });
    expect(fromItp).toMatchObject({ status: 200, isError: false, data: { key: `${project.key}-1` } });
    await callTool(claude.token, "create_task", { project: project.key, title: "Mía" });

    const detail = async (n: number) => getTaskDetail(as(owner), await findTaskId(as(owner), project.id, n));
    expect(await detail(1)).toMatchObject({ reviewStatus: "pending", tags: [{ name: "ITP App" }] });
    expect((await detail(2)).reviewStatus).toBeNull();

    // Marcar un token existente como externo afecta lo que haga de ahí en adelante.
    await setApiTokenExternal(owner.id, claude.id, true);
    await callTool(claude.token, "create_task", { project: project.key, title: "Ahora externa" });
    expect((await detail(3)).reviewStatus).toBe("pending");
  });

  it("aprobar la registra en el historial y se puede deshacer", async () => {
    const { project, owner } = await projectWithRoles();
    const task = await createTask(external(owner.id), { projectId: project.id, title: "Reporte" });
    await setTaskApproval(as(owner), task.id, true);
    let detail = await getTaskDetail(as(owner), task.id);
    expect(detail).toMatchObject({ reviewStatus: "approved", reviewedById: owner.id });
    expect(detail.activity[0]).toMatchObject({ kind: "review", field: "approved" });

    await setTaskApproval(as(owner), task.id, false);
    detail = await getTaskDetail(as(owner), task.id);
    expect(detail).toMatchObject({ reviewStatus: "pending", reviewedById: null, reviewedAt: null });
  });

  it("solo una persona con permiso de edición, desde la app, puede aprobar", async () => {
    const { project, owner, viewer } = await projectWithRoles();
    const task = await createTask(external(owner.id), { projectId: project.id, title: "Reporte" });
    await expect(setTaskApproval({ type: "user", userId: owner.id, via: "Claude" }, task.id, true)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setTaskApproval(external(owner.id), task.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setTaskApproval(as(viewer), task.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const own = await createTask(as(owner), { projectId: project.id, title: "Propia" });
    await expect(setTaskApproval(as(owner), own.id, true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("si el token externo vuelve a cambiar contenido, hay que aprobarla de nuevo; los cambios de personas no", async () => {
    const { project, owner } = await projectWithRoles();
    const ext = external(owner.id);
    const task = await createTask(ext, { projectId: project.id, title: "Reporte" });
    const status = async () => (await getTaskDetail(as(owner), task.id)).reviewStatus;

    await setTaskApproval(as(owner), task.id, true);
    await updateTask(as(owner), { taskId: task.id, title: "Reporte revisado" });
    await addComment(as(owner), { taskId: task.id, bodyMd: "Lo miro" });
    expect(await status()).toBe("approved");

    await updateTask(ext, { taskId: task.id, descriptionMd: "Otro texto" });
    expect(await status()).toBe("pending");
    const { activity } = await getTaskDetail(as(owner), task.id);
    expect(activity.find((a) => a.kind === "review" && a.field === "requested")).toMatchObject({ via: "ITP App" });

    await setTaskApproval(as(owner), task.id, true);
    await addComment(ext, { taskId: task.id, bodyMd: "Más datos" });
    expect(await status()).toBe("pending");

    await setTaskApproval(as(owner), task.id, true);
    await addAttachment(ext, { taskId: task.id, fileName: "captura.png", data: PNG });
    expect(await status()).toBe("pending");
  });

  it("una subtarea externa deja pendiente a la principal, aunque la haya creado una persona", async () => {
    const { project, owner } = await projectWithRoles();
    const parent = await createTask(as(owner), { projectId: project.id, title: "Mía" });
    const sub = await createTask(external(owner.id), { projectId: project.id, title: "Sub", parentId: parent.id });
    expect((await getTaskDetail(as(owner), parent.id)).reviewStatus).toBe("pending");
    expect((await getTaskDetail(as(owner), sub.id)).reviewStatus).toBe("pending");
  });
});
