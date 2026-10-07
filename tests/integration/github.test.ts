import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { domainEvents, taskVcsLinks, webhookDeliveries } from "@/server/db/schema";
import { signPayload } from "@/server/repo-providers/github/provider";
import { ingestWebhook } from "@/server/services/repos";
import { createTask, getTaskDetail } from "@/server/services/tasks";
import { createBranchPayload, deleteBranchPayload, pullRequestPayload, pushPayload, reviewPayload } from "../fixtures/github";
import { connectTestRepo, deliver } from "./github-helpers";
import { as, createTestProject, createUser } from "./helpers";

async function setup() {
  const owner = await createUser("Dueña");
  const { project, columns } = await createTestProject(owner, "GH");
  const repo = await connectTestRepo(project.id);
  const task = await createTask(as(owner), { projectId: project.id, title: "Arreglar login" });
  return { owner, project, columns, repo, task };
}

const eventsOf = async (type: string) => (await db.select().from(domainEvents)).filter((e) => e.type === type);

describe("webhooks de GitHub", () => {
  it("rechaza firmas inválidas sin tocar la base", async () => {
    const res = await ingestWebhook("github", {
      headers: new Headers({ "x-github-event": "create", "x-github-delivery": "1", "x-hub-signature-256": signPayload("otro", "{}") }),
      rawBody: "{}",
    });
    expect(res.status).toBe(401);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it("vincula una rama que menciona la clave y emite branch.created una sola vez", async () => {
    const { task } = await setup();
    await deliver("create", createBranchPayload("gh-1-arreglar-login"));
    await deliver("create", createBranchPayload("gh-1-arreglar-login"));

    const detail = await getTaskDetail({ type: "system" }, task.id);
    expect(detail.links).toMatchObject([{ kind: "branch", externalId: "gh-1-arreglar-login", state: "active" }]);
    expect(await eventsOf("branch.created")).toHaveLength(1);
    expect(detail.activity.some((a) => a.kind === "linked" && a.actorType === "integration")).toBe(true);
  });

  it("es idempotente ante la misma entrega repetida", async () => {
    await setup();
    const payload = pullRequestPayload("opened", { title: "GH-1 arreglo" });
    const first = await deliver("pull_request", payload, "delivery-1");
    const again = await deliver("pull_request", payload, "delivery-1");
    expect(first.status).toBe(200);
    expect(again.message).toBe("Entrega ya procesada");
    expect(await eventsOf("pr.opened")).toHaveLength(1);
  });

  it("sigue el ciclo de vida del PR: abierto → en revisión → mergeado", async () => {
    const { task } = await setup();
    await deliver("pull_request", pullRequestPayload("opened", { title: "Login nuevo", body: "Cierra GH-1" }));
    let link = (await getTaskDetail({ type: "system" }, task.id)).links[0];
    expect(link).toMatchObject({ kind: "pull_request", externalId: "7", state: "open" });

    await deliver("pull_request_review", reviewPayload({ title: "Login nuevo", body: "Cierra GH-1" }));
    link = (await getTaskDetail({ type: "system" }, task.id)).links[0];
    expect(link.state).toBe("in_review");

    // Un push al PR no lo saca de revisión aunque ya no haya revisores pendientes.
    await deliver("pull_request", pullRequestPayload("synchronize", { title: "Login nuevo", body: "Cierra GH-1" }));
    link = (await getTaskDetail({ type: "system" }, task.id)).links[0];
    expect(link.state).toBe("in_review");

    await deliver("pull_request", pullRequestPayload("closed", { title: "Login nuevo", body: "Cierra GH-1", state: "closed", merged: true }));
    link = (await getTaskDetail({ type: "system" }, task.id)).links[0];
    expect(link.state).toBe("merged");
    expect(await eventsOf("pr.opened")).toHaveLength(1);
    expect(await eventsOf("pr.merged")).toHaveLength(1);
  });

  it("vincula PRs por la rama ya vinculada aunque el título no tenga la clave", async () => {
    const { task } = await setup();
    await deliver("create", createBranchPayload("gh-1-login"));
    await deliver("pull_request", pullRequestPayload("opened", { title: "Mejoras", head: "gh-1-login" }));
    const kinds = (await getTaskDetail({ type: "system" }, task.id)).links.map((l) => l.kind).sort();
    expect(kinds).toEqual(["branch", "pull_request"]);
  });

  it("vincula commits por mensaje o por rama y marca ramas borradas", async () => {
    const { task } = await setup();
    await deliver("create", createBranchPayload("gh-1-login"));
    await deliver("push", pushPayload("gh-1-login", [{ id: "aaa111", message: "wip" }]));
    await deliver("push", pushPayload("main", [{ id: "bbb222", message: "fix: GH-1 validación" }, { id: "ccc333", message: "otra cosa" }]));
    await deliver("delete", deleteBranchPayload("gh-1-login"));

    const links = await db.select().from(taskVcsLinks).where(eq(taskVcsLinks.taskId, task.id));
    expect(links.filter((l) => l.kind === "commit").map((l) => l.externalId).sort()).toEqual(["aaa111", "bbb222"]);
    expect(links.find((l) => l.kind === "branch")?.state).toBe("deleted");
  });

  it("ignora repos que no están conectados y claves de otros proyectos", async () => {
    const { task } = await setup();
    await deliver("create", { ...createBranchPayload("gh-1-x"), repository: { ...createBranchPayload("x").repository, id: 1 } });
    await deliver("create", createBranchPayload("otro-1-x"));
    expect((await getTaskDetail({ type: "system" }, task.id)).links).toHaveLength(0);
  });
});
