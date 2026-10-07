import { githubProvider } from "./github/provider";
import type { RepoProvider } from "./types";

/** Registro de proveedores. Para sumar GitLab: implementar RepoProvider y agregarlo acá. */
const providers: Record<string, RepoProvider> = {
  [githubProvider.id]: githubProvider,
};

export function getProvider(id: string): RepoProvider | null {
  return providers[id] ?? null;
}

export function listProviders() {
  return Object.values(providers);
}

export type { RepoProvider, RepoEvent } from "./types";
