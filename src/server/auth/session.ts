import { headers } from "next/headers";
import { auth, type SessionUser } from "./index";

/** Usuario de la request actual, o null. */
export async function getSessionUser(reqHeaders?: Headers): Promise<SessionUser | null> {
  const result = await auth.api.getSession({ headers: reqHeaders ?? (await headers()) });
  if (!result) return null;
  const { id, name, email, image } = result.user;
  return { id, name, email, image: image ?? null };
}
