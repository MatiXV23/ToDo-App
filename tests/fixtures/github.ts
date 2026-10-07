/** Payloads de webhooks de GitHub recortados a los campos que usamos (forma real de la API). */

export const REPO = {
  id: 987654,
  full_name: "matix/todoapp",
  html_url: "https://github.com/matix/todoapp",
  default_branch: "main",
  private: true,
};

export const INSTALLATION = { id: 4242, account: { login: "matix", type: "User" } };

export function createBranchPayload(branch: string) {
  return { ref: branch, ref_type: "branch", master_branch: "main", repository: REPO, installation: { id: INSTALLATION.id } };
}

export function deleteBranchPayload(branch: string) {
  return { ref: branch, ref_type: "branch", repository: REPO, installation: { id: INSTALLATION.id } };
}

export function pushPayload(branch: string, commits: { id: string; message: string }[]) {
  return {
    ref: `refs/heads/${branch}`,
    created: false,
    deleted: false,
    commits: commits.map((c) => ({ ...c, url: `${REPO.html_url}/commit/${c.id}`, author: { name: "Matías", username: "matix" } })),
    repository: REPO,
    installation: { id: INSTALLATION.id },
  };
}

type PrOptions = {
  number?: number;
  title?: string;
  body?: string | null;
  head?: string;
  state?: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
  reviewers?: number;
};

export function pullRequest(o: PrOptions = {}) {
  return {
    number: o.number ?? 7,
    title: o.title ?? "Arreglo",
    body: o.body ?? null,
    html_url: `${REPO.html_url}/pull/${o.number ?? 7}`,
    state: o.state ?? "open",
    draft: o.draft ?? false,
    merged: o.merged ?? false,
    merged_at: o.merged ? "2026-10-07T12:00:00Z" : null,
    head: { ref: o.head ?? "feature/x" },
    base: { ref: "main" },
    user: { login: "matix" },
    requested_reviewers: Array.from({ length: o.reviewers ?? 0 }, (_, i) => ({ login: `rev${i}` })),
    requested_teams: [],
  };
}

export function pullRequestPayload(action: string, o: PrOptions = {}) {
  return { action, number: o.number ?? 7, pull_request: pullRequest(o), repository: REPO, installation: { id: INSTALLATION.id } };
}

export function reviewPayload(o: PrOptions = {}) {
  return { action: "submitted", review: { state: "commented" }, pull_request: pullRequest(o), repository: REPO, installation: { id: INSTALLATION.id } };
}
