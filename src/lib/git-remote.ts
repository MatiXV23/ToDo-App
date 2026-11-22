/**
 * Interpreta lo que alguien (o Claude) pega para identificar un repositorio:
 * `owner/repo`, `github.com/owner/repo`, una URL https o un remoto ssh de git.
 * Devuelve el host y el nombre completo `owner/repo`, o null si no se reconoce.
 */
export function parseGitRemote(input: string): { host: string; fullName: string } | null {
  const value = input.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!value) return null;

  const part = "[A-Za-z0-9_.-]+";
  // owner/repo
  let match = new RegExp(`^(${part})/(${part})$`).exec(value);
  if (match) return finish("github.com", match[1], match[2]);

  // git@github.com:owner/repo (scp-like)
  match = new RegExp(`^[^@/\\s]+@([^:/\\s]+):(${part})/(${part})$`).exec(value);
  if (match) return finish(match[1], match[2], match[3]);

  // https://github.com/owner/repo, ssh://git@github.com:22/owner/repo, github.com/owner/repo
  match = new RegExp(`^(?:[a-z+]+://)?(?:[^@/\\s]+@)?([^:/\\s]+)(?::\\d+)?/(${part})/(${part})$`, "i").exec(value);
  if (match) return finish(match[1], match[2], match[3]);

  return null;
}

function finish(host: string, owner: string, repo: string) {
  if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
  return { host: host.toLowerCase().replace(/^www\./, ""), fullName: `${owner}/${repo}` };
}
