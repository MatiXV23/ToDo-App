import { createSign } from "node:crypto";

/** Acceso a la API de GitHub como GitHub App (JWT + tokens de instalación). */

const API = "https://api.github.com";

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export function githubConfig() {
  const appId = process.env.GITHUB_APP_ID;
  const slug = process.env.GITHUB_APP_SLUG;
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  return { appId, slug, clientId, clientSecret, privateKey: rawKey ? normalizePrivateKey(rawKey) : undefined, webhookSecret };
}

/** Acepta la clave PEM tal cual, con "\n" escapados, o codificada en base64. */
export function normalizePrivateKey(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed.replace(/\\n/g, "\n");
  return Buffer.from(trimmed, "base64").toString("utf8");
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function createAppJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat 60 s en el pasado por diferencias de reloj; GitHub acepta hasta 10 minutos.
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

async function request<T>(path: string, init: RequestInit & { token: string; tokenType?: "Bearer" }): Promise<T> {
  const { token, tokenType = "Bearer", ...rest } = init;
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...rest,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "todoapp",
      Authorization: `${tokenType} ${token}`,
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      message = body.message ?? message;
    } catch {}
    throw new GithubApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function installationToken(installationId: string) {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const { appId, privateKey } = githubConfig();
  if (!appId || !privateKey) throw new Error("La GitHub App no está configurada");
  const result = await request<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST", token: createAppJwt(appId, privateKey) },
  );
  tokenCache.set(installationId, { token: result.token, expiresAt: new Date(result.expires_at).getTime() });
  return result.token;
}

export async function asInstallation<T>(installationId: string, path: string, init: RequestInit = {}) {
  return request<T>(path, { ...init, token: await installationToken(installationId) });
}

export async function asUser<T>(userToken: string, path: string) {
  return request<T>(path, { token: userToken });
}

export async function exchangeOAuthCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = githubConfig();
  if (!clientId || !clientSecret) throw new Error("Falta GITHUB_APP_CLIENT_ID o GITHUB_APP_CLIENT_SECRET");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new GithubApiError(401, body.error_description ?? "No se pudo autorizar con GitHub");
  return body.access_token;
}
