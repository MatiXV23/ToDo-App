import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrState } from "@/lib/domain";
import type {
  BranchStatus,
  IncomingWebhook,
  ParsedWebhook,
  ProviderInstallation,
  ProviderRepository,
  PullRequestInfo,
  PullRequestStatus,
  RepoEvent,
  RepoProvider,
  RepoRef,
} from "../types";
import { asInstallation, asUser, exchangeOAuthCode, GithubApiError, githubConfig } from "./client";

// ─── Tipos mínimos de los payloads que usamos ──────────────────────────

type GhRepo = { id: number; full_name: string; html_url: string; default_branch?: string; private?: boolean };
type GhPullRequest = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  head: { ref: string };
  base: { ref: string };
  user?: { login: string } | null;
  requested_reviewers?: unknown[];
  requested_teams?: unknown[];
};
type GhPayload = {
  action?: string;
  ref?: string;
  ref_type?: string;
  deleted?: boolean;
  commits?: { id: string; message: string; url: string; author?: { username?: string; name?: string } }[];
  repository?: GhRepo;
  pull_request?: GhPullRequest;
  installation?: { id: number; account?: { login: string; type?: string } };
  repositories_removed?: { id: number }[];
};

export function signPayload(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Estado del PR tal como lo mostramos en la tarea. */
export function derivePrState(pr: GhPullRequest, reviewed = false): PrState {
  if (pr.merged || pr.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  const pendingReviews = (pr.requested_reviewers?.length ?? 0) + (pr.requested_teams?.length ?? 0);
  return pendingReviews > 0 || reviewed ? "in_review" : "open";
}

function repoRef(repo: GhRepo): RepoRef {
  return {
    externalId: String(repo.id),
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    defaultBranch: repo.default_branch,
  };
}

function prInfo(pr: GhPullRequest, reviewed = false): PullRequestInfo {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    url: pr.html_url,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    state: derivePrState(pr, reviewed),
    author: pr.user?.login ?? null,
  };
}

/** Traduce un webhook de GitHub a eventos genéricos. Función pura: se testea con payloads reales. */
export function normalizeGithubEvent(event: string, payload: GhPayload): RepoEvent[] {
  const repo = payload.repository ? repoRef(payload.repository) : null;
  switch (event) {
    case "create":
      if (payload.ref_type !== "branch" || !repo || !payload.ref) return [];
      return [{ kind: "branch.created", repo, branch: payload.ref, url: `${repo.htmlUrl}/tree/${payload.ref}` }];
    case "delete":
      if (payload.ref_type !== "branch" || !repo || !payload.ref) return [];
      return [{ kind: "branch.deleted", repo, branch: payload.ref }];
    case "push": {
      if (!repo || !payload.ref?.startsWith("refs/heads/") || payload.deleted) return [];
      const commits = (payload.commits ?? []).map((c) => ({
        sha: c.id,
        message: c.message,
        url: c.url,
        author: c.author?.username ?? c.author?.name ?? null,
      }));
      if (commits.length === 0) return [];
      return [{ kind: "commits.pushed", repo, branch: payload.ref.slice("refs/heads/".length), commits }];
    }
    case "pull_request": {
      const pr = payload.pull_request;
      if (!repo || !pr) return [];
      const info = prInfo(pr);
      if (payload.action === "opened" || payload.action === "reopened") return [{ kind: "pull_request.opened", repo, pr: info }];
      if (payload.action === "closed") {
        return [{ kind: info.state === "merged" ? "pull_request.merged" : "pull_request.closed", repo, pr: info }];
      }
      return [{ kind: "pull_request.updated", repo, pr: info }];
    }
    case "pull_request_review": {
      const pr = payload.pull_request;
      if (!repo || !pr || payload.action !== "submitted") return [];
      return [{ kind: "pull_request.updated", repo, pr: prInfo(pr, true) }];
    }
    case "installation":
      if (payload.action === "deleted" && payload.installation) {
        return [{ kind: "installation.deleted", installationId: String(payload.installation.id) }];
      }
      return [];
    case "installation_repositories":
      if (payload.action === "removed" && payload.installation && payload.repositories_removed?.length) {
        return [
          {
            kind: "installation.repositories_removed",
            installationId: String(payload.installation.id),
            repoIds: payload.repositories_removed.map((r) => String(r.id)),
          },
        ];
      }
      return [];
    default:
      return [];
  }
}

export const githubProvider: RepoProvider = {
  id: "github",
  label: "GitHub",

  isConfigured() {
    const c = githubConfig();
    return !!(c.appId && c.slug && c.clientId && c.clientSecret && c.privateKey && c.webhookSecret);
  },

  verifyWebhook({ headers, rawBody }: IncomingWebhook) {
    const secret = githubConfig().webhookSecret;
    const signature = headers.get("x-hub-signature-256");
    if (!secret || !signature) return false;
    const expected = Buffer.from(signPayload(secret, rawBody));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  },

  parseWebhook({ headers, rawBody }: IncomingWebhook): ParsedWebhook {
    const event = headers.get("x-github-event") ?? "unknown";
    const deliveryId = headers.get("x-github-delivery") ?? "";
    const payload = JSON.parse(rawBody) as GhPayload;
    return { deliveryId, event, action: payload.action ?? null, payload, events: normalizeGithubEvent(event, payload) };
  },

  installUrl(state: string) {
    return `https://github.com/apps/${githubConfig().slug}/installations/new?state=${encodeURIComponent(state)}`;
  },

  authorizeUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({ client_id: githubConfig().clientId ?? "", state, redirect_uri: redirectUri });
    return `https://github.com/login/oauth/authorize?${params}`;
  },

  async userInstallations(code: string, redirectUri: string): Promise<ProviderInstallation[]> {
    const token = await exchangeOAuthCode(code, redirectUri);
    const result = await asUser<{ installations: { id: number; account: { login: string; type?: string } }[] }>(
      token,
      "/user/installations?per_page=100",
    );
    return result.installations.map((i) => ({
      externalId: String(i.id),
      accountLogin: i.account.login,
      accountType: i.account.type ?? null,
    }));
  },

  async listRepositories(installationId: string): Promise<ProviderRepository[]> {
    const repos: ProviderRepository[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await asInstallation<{ repositories: GhRepo[]; total_count: number }>(
        installationId,
        `/installation/repositories?per_page=100&page=${page}`,
      );
      for (const r of result.repositories) {
        repos.push({ ...repoRef(r), defaultBranch: r.default_branch ?? "main", private: !!r.private });
      }
      if (repos.length >= result.total_count || result.repositories.length === 0) break;
    }
    return repos;
  },

  async createBranch(installationId, repo, branch, baseBranch) {
    const base = await asInstallation<{ object: { sha: string } }>(
      installationId,
      `/repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
    );
    try {
      await asInstallation(installationId, `/repos/${repo.fullName}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
      });
      return { created: true, url: `https://github.com/${repo.fullName}/tree/${branch}` };
    } catch (err) {
      // La rama ya existe: se vincula igual.
      if (err instanceof GithubApiError && err.status === 422) {
        return { created: false, url: `https://github.com/${repo.fullName}/tree/${branch}` };
      }
      throw err;
    }
  },

  async branchStatus(installationId, repo, branch, baseBranch): Promise<BranchStatus> {
    try {
      const cmp = await asInstallation<{ ahead_by: number; behind_by: number }>(
        installationId,
        `/repos/${repo.fullName}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branch)}`,
      );
      return { exists: true, aheadBy: cmp.ahead_by, behindBy: cmp.behind_by };
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 404) return { exists: false, aheadBy: null, behindBy: null };
      throw err;
    }
  },

  branchUrl(repo, branch) {
    return `${repo.htmlUrl}/tree/${branch}`;
  },

  async pullRequestStatus(installationId, repo, number): Promise<PullRequestStatus> {
    const pr = await asInstallation<GhPullRequest & { mergeable_state?: string }>(
      installationId,
      `/repos/${repo.fullName}/pulls/${number}`,
    );
    return {
      state: pr.state,
      merged: !!(pr.merged || pr.merged_at),
      draft: !!pr.draft,
      mergeableState: pr.mergeable_state ?? "unknown",
      title: pr.title,
      url: pr.html_url,
    };
  },

  async mergePullRequest(installationId, repo, number) {
    try {
      const result = await asInstallation<{ merged: boolean; message: string }>(
        installationId,
        `/repos/${repo.fullName}/pulls/${number}/merge`,
        { method: "PUT", body: JSON.stringify({ merge_method: "squash" }) },
      );
      return { merged: result.merged, message: result.message };
    } catch (err) {
      if (err instanceof GithubApiError) return { merged: false, message: err.message };
      throw err;
    }
  },
};
