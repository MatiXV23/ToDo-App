import { describe, expect, it } from "vitest";
import { derivePrState, githubProvider, normalizeGithubEvent, signPayload } from "@/server/repo-providers/github/provider";
import { normalizePrivateKey } from "@/server/repo-providers/github/client";
import { extractTaskNumbers } from "@/server/services/repos";
import {
  createBranchPayload,
  deleteBranchPayload,
  pullRequest,
  pullRequestPayload,
  pushPayload,
  reviewPayload,
} from "../fixtures/github";

describe("extracción de claves de tarea", () => {
  it("encuentra claves en ramas, títulos y mensajes", () => {
    expect(extractTaskNumbers("tda-42-revisar-deploy", "TDA")).toEqual([42]);
    expect(extractTaskNumbers("feature/TDA-7-login", "TDA")).toEqual([7]);
    expect(extractTaskNumbers("Arregla TDA-3 y tda-5 (ver TDA-3)", "TDA")).toEqual([3, 5]);
  });

  it("no confunde claves parecidas", () => {
    expect(extractTaskNumbers("XTDA-4", "TDA")).toEqual([]);
    expect(extractTaskNumbers("TDA-420", "TDA")).toEqual([420]);
    expect(extractTaskNumbers("TDAX-1", "TDA")).toEqual([]);
    expect(extractTaskNumbers("sin clave", "TDA")).toEqual([]);
  });
});

describe("estado del PR", () => {
  it("deriva borrador, abierto, en revisión, mergeado y cerrado", () => {
    expect(derivePrState(pullRequest({ draft: true }))).toBe("draft");
    expect(derivePrState(pullRequest())).toBe("open");
    expect(derivePrState(pullRequest({ reviewers: 1 }))).toBe("in_review");
    expect(derivePrState(pullRequest(), true)).toBe("in_review");
    expect(derivePrState(pullRequest({ state: "closed", merged: true }))).toBe("merged");
    expect(derivePrState(pullRequest({ state: "closed" }))).toBe("closed");
  });
});

describe("normalización de webhooks de GitHub", () => {
  it("rama creada y borrada", () => {
    expect(normalizeGithubEvent("create", createBranchPayload("tda-1-x"))).toMatchObject([
      { kind: "branch.created", branch: "tda-1-x", repo: { externalId: "987654", fullName: "matix/todoapp" } },
    ]);
    expect(normalizeGithubEvent("create", { ...createBranchPayload("v1"), ref_type: "tag" })).toEqual([]);
    expect(normalizeGithubEvent("delete", deleteBranchPayload("tda-1-x"))).toMatchObject([{ kind: "branch.deleted" }]);
  });

  it("push con commits", () => {
    const [event] = normalizeGithubEvent("push", pushPayload("main", [{ id: "abc123", message: "TDA-1 arreglo\n\ndetalle" }]));
    expect(event).toMatchObject({ kind: "commits.pushed", branch: "main", commits: [{ sha: "abc123", author: "matix" }] });
  });

  it("acciones de PR", () => {
    expect(normalizeGithubEvent("pull_request", pullRequestPayload("opened"))[0].kind).toBe("pull_request.opened");
    expect(normalizeGithubEvent("pull_request", pullRequestPayload("reopened"))[0].kind).toBe("pull_request.opened");
    expect(normalizeGithubEvent("pull_request", pullRequestPayload("review_requested", { reviewers: 1 }))[0]).toMatchObject({
      kind: "pull_request.updated",
      pr: { state: "in_review" },
    });
    expect(normalizeGithubEvent("pull_request", pullRequestPayload("closed", { state: "closed", merged: true }))[0].kind).toBe(
      "pull_request.merged",
    );
    expect(normalizeGithubEvent("pull_request", pullRequestPayload("closed", { state: "closed" }))[0].kind).toBe(
      "pull_request.closed",
    );
    expect(normalizeGithubEvent("pull_request_review", reviewPayload())[0]).toMatchObject({ pr: { state: "in_review" } });
  });

  it("ignora eventos desconocidos", () => {
    expect(normalizeGithubEvent("star", { action: "created" })).toEqual([]);
  });
});

describe("firma de webhooks", () => {
  it("acepta la firma correcta y rechaza las demás", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "s3cr3t";
    const body = JSON.stringify({ hello: "world" });
    const ok = new Headers({ "x-hub-signature-256": signPayload("s3cr3t", body) });
    const bad = new Headers({ "x-hub-signature-256": signPayload("otro", body) });
    expect(githubProvider.verifyWebhook({ headers: ok, rawBody: body })).toBe(true);
    expect(githubProvider.verifyWebhook({ headers: bad, rawBody: body })).toBe(false);
    expect(githubProvider.verifyWebhook({ headers: ok, rawBody: body + " " })).toBe(false);
    expect(githubProvider.verifyWebhook({ headers: new Headers(), rawBody: body })).toBe(false);
  });
});

describe("clave privada", () => {
  it("acepta PEM con \\n escapados o en base64", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----";
    expect(normalizePrivateKey(pem.replace(/\n/g, "\\n"))).toBe(pem);
    expect(normalizePrivateKey(Buffer.from(pem).toString("base64"))).toBe(pem);
  });
});
