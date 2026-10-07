import { githubProvider } from "./github/provider";
import type { RepoProvider } from "./types";

/** Registro de proveedores. Para sumar GitLab: implementar RepoProvider y agregarlo acá. */
const providers: Record<string, RepoProvider> = {
  [githubProvider.id]: githubProvider,
};

const overrides = new Map<string, RepoProvider>();

/** Para tests: reemplaza un proveedor (por ejemplo, un GitHub falso). */
export function setProviderForTests(provider: RepoProvider | null, id = "github") {
  if (provider) overrides.set(id, provider);
  else overrides.delete(id);
}

export function getProvider(id: string): RepoProvider | null {
  return overrides.get(id) ?? providers[id] ?? null;
}

export function listProviders() {
  return Object.values(providers);
}

export type { RepoProvider, RepoEvent } from "./types";
