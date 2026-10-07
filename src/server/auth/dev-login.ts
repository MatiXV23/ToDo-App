import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

/**
 * Login de desarrollo: inicia sesión con un email sin pasar por Google.
 * Solo se registra si env.devLoginEnabled (nunca con NODE_ENV=production).
 */
export const devLogin = () =>
  ({
    id: "dev-login",
    endpoints: {
      devSignIn: createAuthEndpoint(
        "/dev/sign-in",
        {
          method: "POST",
          body: z.object({
            email: z.email(),
            name: z.string().min(1).max(80).optional(),
          }),
        },
        async (ctx) => {
          if (process.env.NODE_ENV === "production") {
            throw new APIError("NOT_FOUND");
          }
          const email = ctx.body.email.toLowerCase();
          const existing = await ctx.context.internalAdapter.findUserByEmail(email);
          const user =
            existing?.user ??
            (await ctx.context.internalAdapter.createUser({
              email,
              name: ctx.body.name ?? email.split("@")[0],
              emailVerified: true,
            }, { method: "dev-login" }));
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: user.id, email: user.email, name: user.name } });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
