import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/server/db";
import { apiTokens, user } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { hasAccess } from "./access";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(60),
  /** Integración externa (ej. una app que convierte reportes en tareas): sus tareas esperan aprobación. */
  external: z.boolean().default(false),
});

/** Crea un token personal. El valor en claro solo se devuelve acá. */
export async function createApiToken(userId: string, input: z.input<typeof createTokenSchema>) {
  const { name, external } = createTokenSchema.parse(input);
  const token = `tda_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name, external, tokenHash: hash(token), prefix: token.slice(0, 12) })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      external: apiTokens.external,
      createdAt: apiTokens.createdAt,
    });
  return { ...row, token };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      external: apiTokens.external,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

export async function setApiTokenExternal(userId: string, tokenId: string, external: boolean) {
  const [row] = await db
    .update(apiTokens)
    .set({ external })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!row) throw notFound("Token");
}

export async function revokeApiToken(userId: string, tokenId: string) {
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!row) throw notFound("Token");
}

/** Devuelve el usuario dueño del token, o null si no existe o fue revocado. */
export async function authenticateApiToken(token: string) {
  if (!token.startsWith("tda_")) return null;
  const [row] = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      external: apiTokens.external,
      userId: user.id,
      userName: user.name,
      email: user.email,
      image: user.image,
    })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hash(token)), isNull(apiTokens.revokedAt)));
  // Si el admin le quitó el acceso a la app, sus tokens dejan de funcionar.
  if (!row || !(await hasAccess(row.email))) return null;
  // Último uso, como mucho una escritura por minuto.
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.id, row.id), or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, new Date(Date.now() - 60_000)))));
  return {
    tokenName: row.name,
    external: row.external,
    user: { id: row.userId, name: row.userName, email: row.email, image: row.image },
  };
}
