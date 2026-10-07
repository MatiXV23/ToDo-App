import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { account, session, user, verification } from "@/server/db/schema";
import { env } from "@/server/env";
import { onUserCreated } from "@/server/services/members";
import { devLogin } from "./dev-login";

const google = env.google;

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
        // Las invitaciones pendientes para este email aparecen en su buzón.
        after: async (created) => {
          await onUserCreated({ id: created.id, email: created.email });
        },
      },
    },
  },
  plugins: [...(env.devLoginEnabled ? [devLogin()] : []), nextCookies()],
});

export type SessionUser = { id: string; name: string; email: string; image: string | null };
