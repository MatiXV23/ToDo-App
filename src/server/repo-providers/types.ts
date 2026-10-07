import type { PrState } from "@/lib/domain";

/**
 * Interfaz genérica de proveedor de repositorios. GitHub es la primera implementación;
 * para sumar GitLab u otro alcanza con implementar esta interfaz y registrarla.
 */

export type RepoRef = {
  externalId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch?: string;
};

export type PullRequestInfo = {
  number: number;
  title: string;
  body: string;
  url: string;
  headBranch: string;
  baseBranch: string;
  state: PrState;
  author: string | null;
};

export type CommitInfo = { sha: string; message: string; url: string; author: string | null };

/** Eventos normalizados: el resto del sistema no conoce los payloads de cada proveedor. */
export type RepoEvent =
  | { kind: "branch.created"; repo: RepoRef; branch: string; url: string }
  | { kind: "branch.deleted"; repo: RepoRef; branch: string }
  | { kind: "commits.pushed"; repo: RepoRef; branch: string; commits: CommitInfo[] }
  | {
      kind: "pull_request.opened" | "pull_request.updated" | "pull_request.merged" | "pull_request.closed";
      repo: RepoRef;
      pr: PullRequestInfo;
    }
  | { kind: "installation.deleted"; installationId: string }
  | { kind: "installation.repositories_removed"; installationId: string; repoIds: string[] };

export type IncomingWebhook = {
  headers: Headers;
  rawBody: string;
};

export type ParsedWebhook = {
  deliveryId: string;
  event: string;
  action: string | null;
  payload: unknown;
  events: RepoEvent[];
};

export type ProviderInstallation = {
  externalId: string;
  accountLogin: string;
  accountType: string | null;
};

export type ProviderRepository = RepoRef & { defaultBranch: string; private: boolean };

export type BranchStatus = { exists: boolean; aheadBy: number | null; behindBy: number | null };

export interface RepoProvider {
  readonly id: string;
  readonly label: string;
  /** Hay credenciales suficientes para usarlo. */
  isConfigured(): boolean;

  verifyWebhook(webhook: IncomingWebhook): boolean;
  parseWebhook(webhook: IncomingWebhook): ParsedWebhook;

  /** URL para instalar la app o autorizar al usuario. `state` vuelve en el callback. */
  installUrl(state: string): string;
  authorizeUrl(state: string, redirectUri: string): string;
  /** Intercambia el código OAuth y devuelve las instalaciones a las que el usuario tiene acceso. */
  userInstallations(code: string, redirectUri: string): Promise<ProviderInstallation[]>;

  listRepositories(installationId: string): Promise<ProviderRepository[]>;
  createBranch(
    installationId: string,
    repo: { fullName: string },
    branch: string,
    baseBranch: string,
  ): Promise<{ created: boolean; url: string }>;
  branchStatus(
    installationId: string,
    repo: { fullName: string },
    branch: string,
    baseBranch: string,
  ): Promise<BranchStatus>;
  branchUrl(repo: { htmlUrl: string }, branch: string): string;
}
