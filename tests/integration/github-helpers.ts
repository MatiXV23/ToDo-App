import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { projectRepositories, repoInstallations } from "@/server/db/schema";
import { signPayload } from "@/server/repo-providers/github/provider";
import { ingestWebhook } from "@/server/services/repos";
import { INSTALLATION, REPO } from "../fixtures/github";

export async function connectTestRepo(projectId: string) {
  const [installation] = await db
    .insert(repoInstallations)
    .values({ provider: "github", externalId: String(INSTALLATION.id), accountLogin: INSTALLATION.account.login })
    .onConflictDoUpdate({ target: [repoInstallations.provider, repoInstallations.externalId], set: { accountLogin: "matix" } })
    .returning();
  const [repo] = await db
    .insert(projectRepositories)
    .values({
      projectId,
      installationId: installation.id,
      provider: "github",
      externalRepoId: String(REPO.id),
      fullName: REPO.full_name,
      defaultBranch: REPO.default_branch,
      htmlUrl: REPO.html_url,
    })
    .returning();
  return repo;
}

/** Simula una entrega de GitHub firmada con el secreto de tests. */
export async function deliver(event: string, payload: unknown, deliveryId: string = randomUUID()) {
  const rawBody = JSON.stringify(payload);
  const headers = new Headers({
    "x-github-event": event,
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": signPayload(process.env.GITHUB_WEBHOOK_SECRET!, rawBody),
  });
  return ingestWebhook("github", { headers, rawBody });
}
