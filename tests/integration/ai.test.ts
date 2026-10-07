import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { generateObject, setAiProviderForTests } from "@/server/ai";
import type { AiProvider, CompletionRequest } from "@/server/ai/types";
import { parseTasks, suggestDescription, suggestFields, summarize } from "@/server/services/ai";
import { createTag } from "@/server/services/tags";
import { createTask, getTaskDetail } from "@/server/services/tasks";
import { as, projectWithRoles } from "./helpers";

/** Proveedor falso: devuelve las respuestas en orden y registra los pedidos. */
function fakeProvider(responses: string[]) {
  const requests: CompletionRequest[] = [];
  const provider: AiProvider = {
    id: "fake",
    model: "fake-model",
    async complete(request) {
      requests.push(request);
      const text = responses.shift() ?? "{}";
      return { text, model: "fake-model", usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  setAiProviderForTests(provider);
  return requests;
}

afterEach(() => setAiProviderForTests(null));

describe("generateObject", () => {
  it("valida contra el esquema y reintenta una vez con el error", async () => {
    const requests = fakeProvider(['{"x": "no es número"}', '```json\n{"x": 3}\n```']);
    const result = await generateObject(z.object({ x: z.number() }), [{ role: "user", content: "dame json" }]);
    expect(result.data).toEqual({ x: 3 });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)?.content).toMatch(/no cumple el formato/);
    expect(requests[0].json).toBe(true);
  });

  it("falla con un mensaje claro si tampoco cumple al reintentar", async () => {
    fakeProvider(["no json", "tampoco"]);
    await expect(generateObject(z.object({ x: z.number() }), [{ role: "user", content: "json" }])).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("sin API key la IA queda deshabilitada", async () => {
    setAiProviderForTests(null);
    const previous = process.env.AI_API_KEY;
    process.env.AI_API_KEY = "";
    await expect(generateObject(z.object({}), [])).rejects.toMatchObject({ kind: "not_configured" });
    process.env.AI_API_KEY = previous;
  });
});

describe("funciones de IA", () => {
  it("crear desde texto mapea responsables y tags existentes, sin inventar miembros", async () => {
    const { project, owner, editor } = await projectWithRoles();
    const infra = await createTag(as(owner), { projectId: project.id, name: "infra", color: "#000000" });
    const requests = fakeProvider([
      JSON.stringify({
        tasks: [
          { title: "Revisar el deploy", dueDate: "2026-10-08", priority: "high", assignee: "editor", tags: ["Infra", "inexistente"] },
          { title: "Avisarle a Juan", dueDate: "2026-10-08", assignee: "Juan", tags: [] },
        ],
      }),
    ]);
    const tasks = await parseTasks(as(owner), {
      projectId: project.id,
      text: "mañana tengo que revisar el deploy y avisarle a Juan",
      timezone: "America/Argentina/Buenos_Aires",
    });
    expect(tasks).toEqual([
      { title: "Revisar el deploy", descriptionMd: "", dueDate: "2026-10-08", priority: "high", assigneeId: editor.id, tagIds: [infra.id] },
      { title: "Avisarle a Juan", descriptionMd: "", dueDate: "2026-10-08", priority: "medium", assigneeId: null, tagIds: [] },
    ]);
    const prompt = requests[0].messages.at(-1)!.content;
    expect(prompt).toContain("America/Argentina/Buenos_Aires");
    expect(prompt).toContain("avisarle a Juan");
  });

  it("las sugerencias no modifican la tarea", async () => {
    const { project, owner } = await projectWithRoles();
    const task = await createTask(as(owner), { projectId: project.id, title: "Login" });
    fakeProvider([JSON.stringify({ priority: "urgent", estimateHours: 3, tags: ["seguridad"], reasoning: "Bloquea el acceso." })]);
    const suggestion = await suggestFields(as(owner), task.id);
    expect(suggestion).toMatchObject({ priority: "urgent", estimateHours: 3, tagIds: [], newTags: ["seguridad"] });
    const after = await getTaskDetail(as(owner), task.id);
    expect(after.priority).toBe("medium");
    expect(after.estimateHours).toBeNull();
  });

  it("solo lectura puede resumir pero no generar contenido", async () => {
    const { project, viewer } = await projectWithRoles();
    fakeProvider([JSON.stringify({ summaryMd: "- Todo en orden" })]);
    await expect(summarize(as(viewer), { projectId: project.id })).resolves.toBe("- Todo en orden");
    await expect(suggestDescription(as(viewer), { projectId: project.id, title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("alguien de afuera no puede usar la IA sobre el proyecto", async () => {
    const { project, outsider } = await projectWithRoles();
    fakeProvider([JSON.stringify({ summaryMd: "x" })]);
    await expect(summarize(as(outsider), { projectId: project.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("aplica el límite de uso por usuario", async () => {
    const { project, owner } = await projectWithRoles();
    process.env.AI_RATE_LIMIT = "2";
    fakeProvider(Array(5).fill(JSON.stringify({ descriptionMd: "ok" })));
    await suggestDescription(as(owner), { projectId: project.id, title: "a" });
    await suggestDescription(as(owner), { projectId: project.id, title: "b" });
    await expect(suggestDescription(as(owner), { projectId: project.id, title: "c" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    delete process.env.AI_RATE_LIMIT;
  });
});
