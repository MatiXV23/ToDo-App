import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { agentPullRequests, tasks } from "@/server/db/schema";
import { getProvider, setProviderForTests } from "@/server/repo-providers";
import type { PullRequestStatus, RepoProvider } from "@/server/repo-providers/types";
import {
  claimTasks,
  getAgentQueue,
  inMergeWindow,
  releaseTask,
  requeueTask,
  runAgentAutoMerge,
  submitPullRequest,
  updateAgentSettings,
} from "@/server/services/agent";
import { setTaskApproval } from "@/server/services/review";
import { createTask, getTaskDetail, moveTask } from "@/server/services/tasks";
import { pullRequestPayload } from "../fixtures/github";
import { connectTestRepo, deliver } from "./github-helpers";
import { as, projectWithRoles } from "./helpers";

afterEach(() => setProviderForTests(null));

/** GitHub falso: estado de PR configurable y registro de merges. */
function fakeGithub(state: Partial<PullRequestStatus> = {}) {
  const merges: number[] = [];
  const real = getProvider("github")!;
  const provider: RepoProvider = {
    ...real,
    isConfigured: () => true,
    async pullRequestStatus() {
      return { state: "open", merged: false, draft: false, mergeableState: "clean", title: "", url: "", ...state };
    },
    async mergePullRequest(_i, _r, number) {
      merges.push(number);
      return { merged: true, message: "ok" };
    },
  };
  setProviderForTests(provider);
  return merges;
}

async function setup() {
  const ctx = await projectWithRoles();
  await connectTestRepo(ctx.project.id);
  await updateAgentSettings(as(ctx.owner), { projectId: ctx.project.id, enabled: true, mergeFrom: "00:00", mergeUntil: "00:00" });
  const detail = await getTaskDetail(as(ctx.owner), (await createTask(as(ctx.owner), { projectId: ctx.project.id, title: "tmp" })).id);
  const iaTagId = (await db.query.tags.findFirst({ where: (t, { and, eq }) => and(eq(t.projectId, ctx.project.id), eq(t.name, "IA")) }))!.id;
  void detail;
  const key = (n: number) => `${ctx.project.key}-${n}`;
  return { ...ctx, iaTagId, key };
}

describe("agente: cola y tomar tareas", () => {
  it("la cola trae solo tareas con el tag, sin terminar y sin tomar, con su contexto", async () => {
    const { project, owner, iaTagId, columns, key } = await setup();
    const tagged = await createTask(as(owner), { projectId: project.id, title: "Validar email", tagIds: [iaTagId], descriptionMd: "Detalle" });
    await createTask(as(owner), { projectId: project.id, title: "Sin tag" });
    const done = await createTask(as(owner), { projectId: project.id, title: "Hecha", tagIds: [iaTagId] });
    await moveTask(as(owner), { taskId: done.id, columnId: columns.done.id, afterTaskId: null });
    await createTask(as(owner), { projectId: project.id, title: "Sub", parentId: tagged.id });

    const [entry] = await getAgentQueue(as(owner));
    expect(entry.project.key).toBe(project.key);
    expect(entry.repositories).toMatchObject([{ fullName: "matix/todoapp", defaultBranch: "main" }]);
    expect(entry.queued.map((t) => t.title)).toEqual(["Validar email"]);
    expect(entry.queued[0]).toMatchObject({ key: key(tagged.number), description: "Detalle", subtasks: [{ title: "Sub", done: false }] });
    expect(entry.claimed).toEqual([]);
  });

  it("lectura no ve la cola (no puede editar tareas)", async () => {
    const { project, owner, viewer, iaTagId } = await setup();
    await createTask(as(owner), { projectId: project.id, title: "x", tagIds: [iaTagId] });
    expect(await getAgentQueue(as(viewer))).toEqual([]);
  });

  it("tomar tareas las pasa a en curso con la rama y comenta; luego aparecen como 'claimed'", async () => {
    const { project, owner, iaTagId, columns, key } = await setup();
    const a = await createTask(as(owner), { projectId: project.id, title: "A", tagIds: [iaTagId] });
    const b = await createTask(as(owner), { projectId: project.id, title: "B", tagIds: [iaTagId] });
    const agent = { type: "user" as const, userId: owner.id, via: "Agente Claude" };
    await claimTasks(agent, { tasks: [key(a.number), key(b.number)], branch: "claude/a-b" });

    const detail = await getTaskDetail(as(owner), a.id);
    expect(detail).toMatchObject({ agentStatus: "claimed", agentBranch: "claude/a-b", columnId: columns.doing.id });
    expect(detail.comments.at(-1)).toMatchObject({ via: "Agente Claude" });
    const [entry] = await getAgentQueue(as(owner));
    expect(entry.queued).toEqual([]);
    expect(entry.claimed.map((t) => t.title).sort()).toEqual(["A", "B"]);
  });

  it("liberar bloquea la tarea y volver a la cola la hace disponible otra vez", async () => {
    const { project, owner, iaTagId, key } = await setup();
    const t = await createTask(as(owner), { projectId: project.id, title: "Ambigua", tagIds: [iaTagId] });
    await claimTasks(as(owner), { tasks: [key(t.number)], branch: "claude/x" });
    await releaseTask(as(owner), { task: key(t.number), reason: "¿Qué formato de fecha?", blocked: true });
    expect((await getTaskDetail(as(owner), t.id)).agentStatus).toBe("blocked");
    expect(await getAgentQueue(as(owner))).toEqual([]);
    await requeueTask(as(owner), t.id);
    expect((await getAgentQueue(as(owner)))[0].queued.map((x) => x.title)).toEqual(["Ambigua"]);
  });
});

describe("agente: PRs y merge automático", () => {
  async function withPr(complexity: "easy" | "large") {
    const ctx = await setup();
    const t = await createTask(as(ctx.owner), { projectId: ctx.project.id, title: "Chica", tagIds: [ctx.iaTagId] });
    await claimTasks(as(ctx.owner), { tasks: [ctx.key(t.number)], branch: "claude/chica" });
    await submitPullRequest(as(ctx.owner), {
      tasks: [ctx.key(t.number)],
      repository: "matix/todoapp",
      number: 7,
      url: "https://github.com/matix/todoapp/pull/7",
      title: "Chica",
      branch: "claude/chica",
      complexity,
      summary: "Hecho",
    });
    return { ...ctx, task: t };
  }

  it("registra el PR, vincula la tarea y avisa si se mergea solo", async () => {
    const { owner, task } = await withPr("easy");
    const detail = await getTaskDetail(as(owner), task.id);
    expect(detail.agentStatus).toBe("pr_open");
    expect(detail.links).toMatchObject([{ kind: "pull_request", externalId: "7" }]);
    expect(detail.comments.at(-1)?.bodyMd).toMatch(/se mergea solo/);
    const [pr] = await db.select().from(agentPullRequests);
    expect(pr).toMatchObject({ status: "pending", complexity: "easy" });
  });

  it("rechaza repositorios que no están conectados al proyecto", async () => {
    const { owner, project, iaTagId, key } = await setup();
    const t = await createTask(as(owner), { projectId: project.id, title: "x", tagIds: [iaTagId] });
    await expect(
      submitPullRequest(as(owner), { tasks: [key(t.number)], repository: "otro/repo", number: 1, url: "https://x.y/1", branch: "b", complexity: "easy" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("mergea los fáciles dentro de la ventana si los checks pasan", async () => {
    const { task } = await withPr("easy");
    const merges = fakeGithub({ mergeableState: "clean" });
    await runAgentAutoMerge();
    expect(merges).toEqual([7]);
    const [pr] = await db.select().from(agentPullRequests);
    expect(pr).toMatchObject({ status: "merged", lastReason: "Mergeado automáticamente" });
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0].agentStatus).toBe("merged");
  });

  it("no mergea fuera de la ventana horaria", async () => {
    const { owner, project } = await withPr("easy");
    process.env.APP_TIMEZONE = "UTC";
    await updateAgentSettings(as(owner), { projectId: project.id, enabled: true, mergeFrom: "22:00", mergeUntil: "07:00" });
    const merges = fakeGithub();
    await runAgentAutoMerge(new Date("2026-10-07T15:00:00Z"));
    expect(merges).toEqual([]);
    await runAgentAutoMerge(new Date("2026-10-07T23:30:00Z"));
    expect(merges).toEqual([7]);
  });

  it("no mergea solo el PR de una tarea externa hasta que alguien la aprueba", async () => {
    const { project, owner, iaTagId, key } = await setup();
    const itp = { type: "user" as const, userId: owner.id, via: "ITP App", external: true };
    const t = await createTask(itp, { projectId: project.id, title: "Reporte", tagIds: [iaTagId] });
    const [entry] = await getAgentQueue(as(owner));
    expect(entry.queued.find((q) => q.key === key(t.number))).toMatchObject({ review: "pending" });

    await claimTasks(as(owner), { tasks: [key(t.number)], branch: "claude/reporte" });
    const submitted = await submitPullRequest(as(owner), {
      tasks: [key(t.number)],
      repository: "matix/todoapp",
      number: 8,
      url: "https://github.com/matix/todoapp/pull/8",
      branch: "claude/reporte",
      complexity: "easy",
    });
    expect(submitted.waitingApproval).toEqual([key(t.number)]);
    expect((await getTaskDetail(as(owner), t.id)).comments.at(-1)?.bodyMd).toMatch(/cuando apruebes/);

    const merges = fakeGithub({ mergeableState: "clean" });
    await runAgentAutoMerge();
    expect(merges).toEqual([]);
    expect((await db.select().from(agentPullRequests))[0]).toMatchObject({ status: "pending", lastReason: `Espera que apruebes ${key(t.number)}` });

    await setTaskApproval(as(owner), t.id, true);
    await runAgentAutoMerge(new Date(Date.now() + 5 * 60_000));
    expect(merges).toEqual([8]);
  });

  it("no mergea con checks fallando y deja el motivo", async () => {
    await withPr("easy");
    const merges = fakeGithub({ mergeableState: "unstable" });
    await runAgentAutoMerge();
    expect(merges).toEqual([]);
    const [pr] = await db.select().from(agentPullRequests);
    expect(pr).toMatchObject({ status: "pending", lastReason: "Hay checks fallando" });
  });

  it("los grandes nunca se mergean solos; cuando alguien los mergea, el webhook los marca", async () => {
    const { task } = await withPr("large");
    const merges = fakeGithub();
    await runAgentAutoMerge();
    expect(merges).toEqual([]);
    expect((await db.select().from(agentPullRequests))[0].status).toBe("waiting_review");

    await deliver("pull_request", pullRequestPayload("closed", { number: 7, title: "Chica", head: "claude/chica", state: "closed", merged: true }));
    expect((await db.select().from(agentPullRequests))[0].status).toBe("merged");
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0].agentStatus).toBe("merged");
  });
});

describe("ventana de merge", () => {
  it("soporta ventanas normales y que cruzan la medianoche", () => {
    const at = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00Z`);
    expect(inMergeWindow(at("23:00"), "22:00", "07:00", "UTC")).toBe(true);
    expect(inMergeWindow(at("03:00"), "22:00", "07:00", "UTC")).toBe(true);
    expect(inMergeWindow(at("07:00"), "22:00", "07:00", "UTC")).toBe(false);
    expect(inMergeWindow(at("12:00"), "22:00", "07:00", "UTC")).toBe(false);
    expect(inMergeWindow(at("13:00"), "09:00", "18:00", "UTC")).toBe(true);
    expect(inMergeWindow(at("19:00"), "09:00", "18:00", "UTC")).toBe(false);
    // 01:00 UTC = 22:00 del día anterior en Buenos Aires.
    expect(inMergeWindow(at("01:00"), "22:00", "07:00", "America/Argentina/Buenos_Aires")).toBe(true);
    expect(inMergeWindow(at("00:00"), "00:00", "00:00", "UTC")).toBe(true);
  });
});
