import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { createMcpServer } from "@/server/mcp/server";
import type { Actor } from "@/server/permissions/access";
import { updateAgentSettings } from "@/server/services/agent";
import { createApiToken, revokeApiToken } from "@/server/services/api-tokens";
import { findTaskId, getTaskDetail } from "@/server/services/tasks";
import { as, projectWithRoles } from "./helpers";

async function connect(actor: Actor) {
  const server = createMcpServer(actor);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { error: !!res.isError, text, data: data as Record<string, unknown> };
  };
  return { client, call };
}

describe("servidor MCP", () => {
  it("expone las herramientas esperadas", async () => {
    const { owner } = await projectWithRoles();
    const { client } = await connect(as(owner));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_attachment",
        "add_comment",
        "agent_claim",
        "agent_queue",
        "agent_release",
        "agent_submit_pr",
        "create_task",
        "get_board",
        "get_task",
        "list_projects",
        "move_task",
        "search_tasks",
        "update_task",
      ].sort(),
    );
  });

  it("crea, edita, mueve, comenta y lee tareas usando nombres en vez de ids", async () => {
    const { project, owner, editor } = await projectWithRoles();
    const { call } = await connect({ type: "user", userId: owner.id, via: "Claude" });
    const created = await call("create_task", {
      project: project.key,
      title: "Revisar el deploy",
      priority: "high",
      assignee: editor.email,
      tags: ["infra"],
      column: "en curso",
    });
    expect(created.error).toBe(false);
    const key = created.data.key as string;
    expect(key).toBe(`${project.key}-1`);

    expect((await call("update_task", { task: key, description: "Pasos", assignee: "me" })).error).toBe(false);
    expect((await call("move_task", { task: key, column: "Hecho" })).data).toMatchObject({ column: "Hecho", changed: true });
    expect((await call("add_comment", { task: key, body: "Listo" })).error).toBe(false);

    const task = (await call("get_task", { task: key })).data;
    expect(task).toMatchObject({ title: "Revisar el deploy", column: "Hecho", assignee: owner.name, tags: ["infra"], description: "Pasos" });
    expect(task.comments).toMatchObject([{ body: "Listo", via: "Claude" }]);

    const board = (await call("get_board", { project: project.key })).data as { columns: { name: string; tasks: { key: string }[] }[] };
    expect(board.columns.find((c) => c.name === "Hecho")?.tasks.map((t) => t.key)).toEqual([key]);
    expect((await call("search_tasks", { project: project.key, query: "deploy" })).data).toMatchObject([{ key }]);
  });

  it("respeta los permisos del dueño del token y devuelve errores legibles", async () => {
    const { project, viewer, outsider } = await projectWithRoles();
    const asViewer = await connect(as(viewer));
    expect((await asViewer.call("get_board", { project: project.key })).error).toBe(false);
    const denied = await asViewer.call("create_task", { project: project.key, title: "x" });
    expect(denied).toMatchObject({ error: true, text: "No tenés permiso para hacer esto" });

    const asOutsider = await connect(as(outsider));
    expect((await asOutsider.call("get_board", { project: project.key })).text).toBe("Proyecto no encontrado");
    expect(await asOutsider.call("list_projects")).toMatchObject({ data: [] });

    const { owner } = await projectWithRoles();
    const asOwner = await connect(as(owner));
    expect((await asOwner.call("move_task", { task: "NOPE-1", column: "x" })).error).toBe(true);
  });

  it("el endpoint HTTP exige un token válido y no revocado", async () => {
    const { owner } = await projectWithRoles();
    const request = (token?: string) =>
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      });
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("tda_inventado"))).status).toBe(401);
    const token = await createApiToken(owner.id, { name: "Claude" });
    const ok = await POST(request(token.token));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("todoapp");
    await revokeApiToken(owner.id, token.id);
    expect((await POST(request(token.token))).status).toBe(401);
  });

  it("el flujo del agente funciona por MCP", async () => {
    const { project, owner } = await projectWithRoles();
    await updateAgentSettings(as(owner), { projectId: project.id, enabled: true, mergeFrom: "22:00", mergeUntil: "07:00" });
    const { call } = await connect({ type: "user", userId: owner.id, via: "Agente" });
    const created = await call("create_task", { project: project.key, title: "Para Claude", tags: ["IA"] });
    const key = created.data.key as string;
    const queue = (await call("agent_queue")).data as unknown as { queued: { key: string }[] }[];
    expect(queue[0].queued.map((t) => t.key)).toEqual([key]);
    expect((await call("agent_claim", { tasks: [key], branch: "claude/para-claude" })).error).toBe(false);
    const released = await call("agent_release", { task: key, reason: "Falta definir el alcance" });
    expect(released.data).toMatchObject({ status: "blocked" });
    const detail = await getTaskDetail(as(owner), await findTaskId(as(owner), project.id, 1));
    expect(detail.agentStatus).toBe("blocked");
  });
});
