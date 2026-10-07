import type { Actor } from "@/server/permissions/access";
import { authenticateApiToken } from "@/server/services/api-tokens";
import { getSessionUser } from "./session";

/** Actor de una request a un route handler: sesión del navegador o token de API (Bearer). */
export async function getRequestActor(req: Request): Promise<Actor | null> {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const result = await authenticateApiToken(authorization.slice(7).trim());
    return result ? { type: "user", userId: result.user.id, via: result.tokenName } : null;
  }
  const user = await getSessionUser(req.headers);
  return user ? { type: "user", userId: user.id } : null;
}
