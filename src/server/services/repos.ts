import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import {
  projectRepositories,
  projects,
  repoInstallations,
  repoInstallationUsers,
  tasks,
  taskVcsLinks,
  webhookDeliveries,
} from "@/server/db/schema";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { emitDomainEvent, projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";
import { getProvider, type RepoEvent } from "@/server/repo-providers";
import type { IncomingWebhook, ProviderInstallation, PullRequestInfo } from "@/server/repo-providers/types";
import type { PrState } from "@/lib/domain";
import { logActivity } from "./activity";
import { loadTask } from "./tasks";

// ─── Vinculación por clave de tarea ─────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Números de tarea mencionados en un texto (`TDA-42`, `tda-42-arreglar-login`, `feature/TDA-42`).
 * No matchea dentro de otras palabras ni números más largos (`XTDA-4`, `TDA-420` ≠ 42).
 */
export function extractTaskNumbers(text: string, projectKey: string): number[] {
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(projectKey)}-(\\d+)(?![0-9])`, "gi");
  const found = new Set<number>();
  for (const match of text.matchAll(re)) found.add(Number(match[1]));
  return [...found];
}

const integration = (provider: string): Actor => ({ type: "integration", provider });

type ConnectedRepo = { id: string; projectId: string; projectKey: string; fullName: string; htmlUrl: string };

async function connectedRepos(tx: Tx, provider: string, externalRepoId: string): Promise<ConnectedRepo[]> {
  return tx
    .select({
      id: projectRepositories.id,
      projectId: projectRepositories.projectId,
      projectKey: projects.key,
      fullName: projectRepositories.fullName,
      htmlUrl: projectRepositories.htmlUrl,
    })
    .from(projectRepositories)
    .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
    .where(and(eq(projectRepositories.provider, provider), eq(projectRepositories.externalRepoId, externalRepoId)));
}

async function taskIdsByNumber(tx: Tx, projectId: string, numbers: number[]) {
  if (numbers.length === 0) return [];
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.number, numbers), isNull(tasks.deletedAt)));
  return rows.map((r) => r.id);
}

/** Tareas que ya tienen vinculada una rama en ese repo. */
async function tasksLinkedToBranch(tx: Tx, repoId: string, branch: string) {
  const rows = await tx
    .select({ taskId: taskVcsLinks.taskId })
    .from(taskVcsLinks)
    .where(
      and(
        eq(taskVcsLinks.projectRepositoryId, repoId),
        eq(taskVcsLinks.kind, "branch"),
        eq(taskVcsLinks.externalId, branch),
      ),
    );
  return rows.map((r) => r.taskId);
}

type LinkInput = {
  taskId: string;
  repoId: string;
  kind: "branch" | "commit" | "pull_request";
  externalId: string;
  title: string;
  url: string;
  state: string;
  data?: Record<string, unknown>;
};

async function upsertLink(tx: Tx, link: LinkInput) {
  const [existing] = await tx
    .select({ id: taskVcsLinks.id, state: taskVcsLinks.state })
    .from(taskVcsLinks)
    .where(
      and(
        eq(taskVcsLinks.taskId, link.taskId),
        eq(taskVcsLinks.projectRepositoryId, link.repoId),
        eq(taskVcsLinks.kind, link.kind),
        eq(taskVcsLinks.externalId, link.externalId),
      ),
    );
  const [row] = await tx
    .insert(taskVcsLinks)
    .values({
      taskId: link.taskId,
      projectRepositoryId: link.repoId,
      kind: link.kind,
      externalId: link.externalId,
      title: link.title,
      url: link.url,
      state: link.state,
      data: link.data ?? {},
    })
    .onConflictDoUpdate({
      target: [taskVcsLinks.taskId, taskVcsLinks.projectRepositoryId, taskVcsLinks.kind, taskVcsLinks.externalId],
      set: { title: link.title, url: link.url, state: link.state, data: link.data ?? {}, updatedAt: new Date() },
    })
    .returning({ id: taskVcsLinks.id });
  return { id: row.id, inserted: !existing, previousState: existing?.state ?? null };
}

const LINK_LABEL = { branch: "la rama", commit: "el commit", pull_request: "el PR" } as const;

async function onLinked(tx: Tx, actor: Actor, projectId: string, taskId: string, link: LinkInput) {
  await logActivity(tx, actor, [
    {
      taskId,
      projectId,
      kind: "linked",
      field: link.kind,
      newValue: {
        id: link.externalId,
        label: `${LINK_LABEL[link.kind]} ${link.kind === "pull_request" ? `#${link.externalId}` : link.title}`,
      },
    },
  ]);
}

/** Estado nuevo del PR. "En revisión" se mantiene aunque GitHub ya no liste revisores pendientes. */
function nextPrState(previous: string | null, incoming: PrState, kind: RepoEvent["kind"]): PrState {
  if (incoming === "open" && previous === "in_review" && kind === "pull_request.updated") return "in_review";
  return incoming;
}

async function applyPullRequest(
  tx: Tx,
  provider: string,
  repo: ConnectedRepo,
  kind: RepoEvent["kind"],
  pr: PullRequestInfo,
  affected: Set<string>,
) {
  const actor = integration(provider);
  const mentioned = extractTaskNumbers(`${pr.title}\n${pr.body}\n${pr.headBranch}`, repo.projectKey);
  const taskIds = new Set([
    ...(await taskIdsByNumber(tx, repo.projectId, mentioned)),
    ...(await tasksLinkedToBranch(tx, repo.id, pr.headBranch)),
  ]);
  for (const taskId of taskIds) {
    const [prev] = await tx
      .select({ state: taskVcsLinks.state })
      .from(taskVcsLinks)
      .where(
        and(
          eq(taskVcsLinks.taskId, taskId),
          eq(taskVcsLinks.projectRepositoryId, repo.id),
          eq(taskVcsLinks.kind, "pull_request"),
          eq(taskVcsLinks.externalId, String(pr.number)),
        ),
      );
    const state = nextPrState(prev?.state ?? null, pr.state, kind);
    const link: LinkInput = {
      taskId,
      repoId: repo.id,
      kind: "pull_request",
      externalId: String(pr.number),
      title: pr.title,
      url: pr.url,
      state,
      data: { headBranch: pr.headBranch, baseBranch: pr.baseBranch, author: pr.author },
    };
    const result = await upsertLink(tx, link);
    if (result.inserted) await onLinked(tx, actor, repo.projectId, taskId, link);

    const isOpen = state === "open" || state === "draft" || state === "in_review";
    if (kind === "pull_request.opened" || (result.inserted && isOpen)) {
      await emitDomainEvent(tx, {
        projectId: repo.projectId,
        type: "pr.opened",
        taskId,
        actor,
        payload: { pr: { number: pr.number, title: pr.title, url: pr.url, branch: pr.headBranch }, repo: repo.fullName },
      });
    }
    if (state === "merged" && result.previousState !== "merged") {
      await emitDomainEvent(tx, {
        projectId: repo.projectId,
        type: "pr.merged",
        taskId,
        actor,
        payload: { pr: { number: pr.number, title: pr.title, url: pr.url, branch: pr.headBranch }, repo: repo.fullName },
      });
    }
    affected.add(`${repo.projectId}:${taskId}`);
  }
}

/** Aplica un evento normalizado: vincula tareas, actualiza estados y emite eventos de dominio. */
export async function applyRepoEvent(provider: string, event: RepoEvent) {
  await db.transaction(async (tx) => {
    if (event.kind === "installation.deleted") {
      await tx
        .delete(repoInstallations)
        .where(and(eq(repoInstallations.provider, provider), eq(repoInstallations.externalId, event.installationId)));
      return;
    }
    if (event.kind === "installation.repositories_removed") {
      const [installation] = await tx
        .select({ id: repoInstallations.id })
        .from(repoInstallations)
        .where(and(eq(repoInstallations.provider, provider), eq(repoInstallations.externalId, event.installationId)));
      if (installation) {
        await tx
          .delete(projectRepositories)
          .where(
            and(
              eq(projectRepositories.installationId, installation.id),
              inArray(projectRepositories.externalRepoId, event.repoIds),
            ),
          );
      }
      return;
    }

    const actor = integration(provider);
    const affected = new Set<string>();
    for (const repo of await connectedRepos(tx, provider, event.repo.externalId)) {
      switch (event.kind) {
        case "branch.created": {
          const taskIds = await taskIdsByNumber(tx, repo.projectId, extractTaskNumbers(event.branch, repo.projectKey));
          for (const taskId of taskIds) {
            const link: LinkInput = {
              taskId,
              repoId: repo.id,
              kind: "branch",
              externalId: event.branch,
              title: event.branch,
              url: event.url,
              state: "active",
            };
            const result = await upsertLink(tx, link);
            if (result.inserted) {
              await onLinked(tx, actor, repo.projectId, taskId, link);
              await emitDomainEvent(tx, {
                projectId: repo.projectId,
                type: "branch.created",
                taskId,
                actor,
                payload: { branch: event.branch, repo: repo.fullName, url: event.url },
              });
            }
            affected.add(`${repo.projectId}:${taskId}`);
          }
          break;
        }
        case "branch.deleted": {
          const updated = await tx
            .update(taskVcsLinks)
            .set({ state: "deleted", updatedAt: new Date() })
            .where(
              and(
                eq(taskVcsLinks.projectRepositoryId, repo.id),
                eq(taskVcsLinks.kind, "branch"),
                eq(taskVcsLinks.externalId, event.branch),
              ),
            )
            .returning({ taskId: taskVcsLinks.taskId });
          for (const u of updated) affected.add(`${repo.projectId}:${u.taskId}`);
          break;
        }
        case "commits.pushed": {
          const branchTasks = await tasksLinkedToBranch(tx, repo.id, event.branch);
          for (const commit of event.commits) {
            const taskIds = new Set([
              ...branchTasks,
              ...(await taskIdsByNumber(tx, repo.projectId, extractTaskNumbers(commit.message, repo.projectKey))),
            ]);
            for (const taskId of taskIds) {
              await upsertLink(tx, {
                taskId,
                repoId: repo.id,
                kind: "commit",
                externalId: commit.sha,
                title: commit.message.split("\n")[0].slice(0, 200),
                url: commit.url,
                state: "pushed",
                data: { author: commit.author, branch: event.branch },
              });
              affected.add(`${repo.projectId}:${taskId}`);
            }
          }
          break;
        }
        case "pull_request.opened":
        case "pull_request.updated":
        case "pull_request.merged":
        case "pull_request.closed":
          await applyPullRequest(tx, provider, repo, event.kind, event.pr, affected);
          break;
      }
    }

    const byProject = new Map<string, string[]>();
    for (const key of affected) {
      const [projectId, taskId] = key.split(":");
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), taskId]);
    }
    for (const [projectId, taskIds] of byProject) {
      await publish(tx, projectChannel(projectId), { type: "board", taskIds }, actor);
      for (const taskId of taskIds) await publish(tx, projectChannel(projectId), { type: "task", taskId }, actor);
    }
  });
}

// ─── Webhooks ───────────────────────────────────────────────────────────

export async function ingestWebhook(providerId: string, webhook: IncomingWebhook): Promise<{ status: number; message: string }> {
  const provider = getProvider(providerId);
  if (!provider) return { status: 404, message: "Proveedor desconocido" };
  if (!provider.verifyWebhook(webhook)) return { status: 401, message: "Firma inválida" };

  const parsed = provider.parseWebhook(webhook);
  if (!parsed.deliveryId) return { status: 400, message: "Falta el id de entrega" };

  // Idempotencia: cada entrega se procesa una sola vez (salvo que haya fallado antes).
  const [inserted] = await db
    .insert(webhookDeliveries)
    .values({
      provider: provider.id,
      deliveryId: parsed.deliveryId,
      event: parsed.event,
      action: parsed.action,
      payload: parsed.payload as object,
    })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  let deliveryId = inserted?.id;
  if (!deliveryId) {
    const [existing] = await db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.provider, provider.id), eq(webhookDeliveries.deliveryId, parsed.deliveryId)));
    if (existing?.processedAt) return { status: 200, message: "Entrega ya procesada" };
    deliveryId = existing!.id;
  }

  try {
    for (const event of parsed.events) await applyRepoEvent(provider.id, event);
    await db
      .update(webhookDeliveries)
      .set({ processedAt: new Date(), error: null })
      .where(eq(webhookDeliveries.id, deliveryId));
    return { status: 200, message: `${parsed.events.length} eventos procesados` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(webhookDeliveries).set({ error: message }).where(eq(webhookDeliveries.id, deliveryId));
    console.error(`[webhook] ${provider.id} ${parsed.event} falló`, err);
    return { status: 500, message: "Error procesando el evento" };
  }
}

// ─── Instalaciones y repositorios ───────────────────────────────────────

/** Registra las instalaciones a las que el usuario demostró tener acceso vía OAuth. */
export async function linkInstallations(userId: string, providerId: string, installations: ProviderInstallation[]) {
  await db.transaction(async (tx) => {
    for (const inst of installations) {
      const [row] = await tx
        .insert(repoInstallations)
        .values({ provider: providerId, externalId: inst.externalId, accountLogin: inst.accountLogin, accountType: inst.accountType })
        .onConflictDoUpdate({
          target: [repoInstallations.provider, repoInstallations.externalId],
          set: { accountLogin: inst.accountLogin, accountType: inst.accountType },
        })
        .returning({ id: repoInstallations.id });
      await tx.insert(repoInstallationUsers).values({ installationId: row.id, userId }).onConflictDoNothing();
    }
  });
}

async function myInstallations(userId: string, providerId: string) {
  return db
    .select({
      id: repoInstallations.id,
      externalId: repoInstallations.externalId,
      accountLogin: repoInstallations.accountLogin,
    })
    .from(repoInstallationUsers)
    .innerJoin(repoInstallations, eq(repoInstallations.id, repoInstallationUsers.installationId))
    .where(and(eq(repoInstallationUsers.userId, userId), eq(repoInstallations.provider, providerId)));
}

export async function getIntegrationStatus(actor: Actor, projectId: string, providerId = "github") {
  const role = await authorize(db, actor, projectId, "project.view");
  const provider = getProvider(providerId);
  const repos = await db
    .select({
      id: projectRepositories.id,
      fullName: projectRepositories.fullName,
      htmlUrl: projectRepositories.htmlUrl,
      defaultBranch: projectRepositories.defaultBranch,
      provider: projectRepositories.provider,
    })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projectId));
  const installations = actor.type === "user" && role === "owner" ? await myInstallations(actor.userId, providerId) : [];
  return { configured: provider?.isConfigured() ?? false, repos, installations };
}

export async function listAvailableRepos(actor: Actor, projectId: string, providerId = "github") {
  await authorize(db, actor, projectId, "repo.connect");
  if (actor.type !== "user") throw forbidden();
  const provider = getProvider(providerId);
  if (!provider?.isConfigured()) throw badRequest("La integración no está configurada");
  const installations = await myInstallations(actor.userId, providerId);
  const connected = await db
    .select({ externalRepoId: projectRepositories.externalRepoId })
    .from(projectRepositories)
    .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.provider, providerId)));
  const connectedIds = new Set(connected.map((c) => c.externalRepoId));
  const results = await Promise.all(
    installations.map(async (inst) => {
      try {
        const repos = await provider.listRepositories(inst.externalId);
        return repos.map((r) => ({ ...r, installationId: inst.id, account: inst.accountLogin, connected: connectedIds.has(r.externalId) }));
      } catch (err) {
        console.error(`[repos] no se pudieron listar los repos de ${inst.accountLogin}`, err);
        return [];
      }
    }),
  );
  return results.flat();
}

export async function connectRepo(
  actor: Actor,
  input: { projectId: string; installationId: string; externalRepoId: string },
  providerId = "github",
) {
  await authorize(db, actor, input.projectId, "repo.connect");
  if (actor.type !== "user") throw forbidden();
  const provider = getProvider(providerId);
  if (!provider) throw notFound("Proveedor");
  const installation = (await myInstallations(actor.userId, providerId)).find((i) => i.id === input.installationId);
  if (!installation) throw forbidden("No tenés acceso a esa instalación");
  const repo = (await provider.listRepositories(installation.externalId)).find((r) => r.externalId === input.externalRepoId);
  if (!repo) throw notFound("Repositorio");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projectRepositories)
      .values({
        projectId: input.projectId,
        installationId: installation.id,
        provider: providerId,
        externalRepoId: repo.externalId,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        htmlUrl: repo.htmlUrl,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict("El repositorio ya está conectado");
    await publish(tx, projectChannel(input.projectId), { type: "project" }, actor);
    return row;
  });
}

export async function disconnectRepo(actor: Actor, projectRepositoryId: string) {
  const [repo] = await db.select().from(projectRepositories).where(eq(projectRepositories.id, projectRepositoryId));
  if (!repo) throw notFound("Repositorio");
  await db.transaction(async (tx) => {
    await authorize(tx, actor, repo.projectId, "repo.connect");
    await tx.delete(projectRepositories).where(eq(projectRepositories.id, projectRepositoryId));
    await publish(tx, projectChannel(repo.projectId), { type: "project" }, actor);
    await publish(tx, projectChannel(repo.projectId), { type: "board" }, actor);
  });
}

async function loadProjectRepo(projectRepositoryId: string) {
  const [repo] = await db
    .select({
      id: projectRepositories.id,
      projectId: projectRepositories.projectId,
      provider: projectRepositories.provider,
      fullName: projectRepositories.fullName,
      htmlUrl: projectRepositories.htmlUrl,
      defaultBranch: projectRepositories.defaultBranch,
      installationExternalId: repoInstallations.externalId,
    })
    .from(projectRepositories)
    .innerJoin(repoInstallations, eq(repoInstallations.id, projectRepositories.installationId))
    .where(eq(projectRepositories.id, projectRepositoryId));
  if (!repo) throw notFound("Repositorio");
  return repo;
}

export async function createBranchForTask(
  actor: Actor,
  input: { taskId: string; projectRepositoryId: string; branch: string; baseBranch?: string },
) {
  const task = await loadTask(db, input.taskId);
  await authorize(db, actor, task.projectId, "repo.link");
  const repo = await loadProjectRepo(input.projectRepositoryId);
  if (repo.projectId !== task.projectId) throw badRequest("El repositorio no pertenece al proyecto");
  const branch = input.branch.trim();
  if (!/^[A-Za-z0-9._\-/]+$/.test(branch) || branch.includes("..") || branch.endsWith("/")) {
    throw badRequest("Nombre de rama inválido");
  }
  const provider = getProvider(repo.provider);
  if (!provider?.isConfigured()) throw badRequest("La integración no está configurada");

  const result = await provider.createBranch(
    repo.installationExternalId,
    repo,
    branch,
    input.baseBranch?.trim() || repo.defaultBranch,
  );
  await db.transaction(async (tx) => {
    const link: LinkInput = {
      taskId: task.id,
      repoId: repo.id,
      kind: "branch",
      externalId: branch,
      title: branch,
      url: result.url,
      state: "active",
    };
    const upsert = await upsertLink(tx, link);
    if (upsert.inserted) {
      await onLinked(tx, actor, task.projectId, task.id, link);
      await emitDomainEvent(tx, {
        projectId: task.projectId,
        type: "branch.created",
        taskId: task.id,
        actor,
        payload: { branch, repo: repo.fullName, url: result.url },
      });
    }
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
  });
  return { ...result, branch };
}

export async function unlinkVcs(actor: Actor, linkId: string) {
  const [link] = await db.select().from(taskVcsLinks).where(eq(taskVcsLinks.id, linkId));
  if (!link) throw notFound("Vínculo");
  const task = await loadTask(db, link.taskId);
  await db.transaction(async (tx) => {
    await authorize(tx, actor, task.projectId, "repo.link");
    await tx.delete(taskVcsLinks).where(eq(taskVcsLinks.id, linkId));
    await logActivity(tx, actor, [
      {
        taskId: task.id,
        projectId: task.projectId,
        kind: "unlinked",
        field: link.kind,
        oldValue: { id: link.externalId, label: `${LINK_LABEL[link.kind]} ${link.kind === "pull_request" ? `#${link.externalId}` : link.title}` },
      },
    ]);
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
  });
}

/** Commits adelante/atrás de una rama vinculada respecto de la rama base (se consulta a demanda). */
export async function getBranchStatus(actor: Actor, linkId: string) {
  const [link] = await db.select().from(taskVcsLinks).where(eq(taskVcsLinks.id, linkId));
  if (!link || link.kind !== "branch") throw notFound("Rama");
  const task = await loadTask(db, link.taskId);
  await authorize(db, actor, task.projectId, "project.view");
  const repo = await loadProjectRepo(link.projectRepositoryId);
  const provider = getProvider(repo.provider);
  if (!provider?.isConfigured()) return null;
  return provider.branchStatus(repo.installationExternalId, repo, link.externalId, repo.defaultBranch);
}

