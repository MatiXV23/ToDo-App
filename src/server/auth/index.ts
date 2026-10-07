import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { account, session, user, verification } from "@/server/db/schema";
import { env } from "@/server/env";
import { checkAccess } from "@/server/services/access";
import { onUserCreated } from "@/server/services/members";
import { devLogin } from "./dev-login";

const google = env.google;

/** El login de desarrollo no pasa por la aprobación del admin. */
const isDevLogin = (ctx: { path?: string } | null) => ctx?.path?.startsWith("/dev/") ?? false;

/**
 * Corta el inicio de sesión de quien no tiene acceso. Better Auth convierte el error en una
 * redirección a /login?error=access_pending (o access_denied).
 */
async function assertAccess(person: { email: string; name?: string | null; image?: string | null }) {
  const result = await checkAccess(person);
  if (result.ok) return;
  throw new APIError("FORBIDDEN", {
    code: `access_${result.reason}`,
    message: result.reason === "pending" ? "Tu solicitud de acceso está pendiente" : "No tenés acceso a ToDoApp",
  });
}

export const auth = betterAuth({
  baseURL: env.appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  // Google es el único método de login. El login de desarrollo solo existe fuera de producción.
  emailAndPassword: { enabled: false },
  socialProviders: google
    ? { google: { clientId: google.clientId, clientSecret: google.clientSecret, prompt: "select_account" } }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  databaseHooks: {
    user: {
      create: {
        // Solo se crea el usuario si el admin le dio acceso a la app.
        before: async (data, ctx) => {
          if (!isDevLogin(ctx)) await assertAccess(data);
        },
        // Las invitaciones pendientes para este email aparecen en su buzón.
        after: async (created) => {
          await onUserCreated({ id: created.id, email: created.email });
        },
      },
    },
    session: {
      create: {
        // Usuarios existentes a los que se les quitó el acceso.
        before: async (data, ctx) => {
          if (isDevLogin(ctx)) return;
          const [existing] = await db.select().from(user).where(eq(user.id, data.userId));
          if (existing) await assertAccess(existing);
        },
      },
    },
  },
  plugins: [...(env.devLoginEnabled ? [devLogin()] : []), nextCookies()],
});

export type SessionUser = { id: string; name: string; email: string; image: string | null; isAdmin: boolean };
