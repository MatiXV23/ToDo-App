import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import * as z from "zod";
import { getSessionUser } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/permissions/access";

export async function createContext(opts: { headers: Headers }) {
  const user = await getSessionUser(opts.headers);
  return { user, clientId: opts.headers.get("x-client-id") };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        fieldErrors: error.cause instanceof z.ZodError ? z.flattenError(error.cause).fieldErrors : null,
      },
    };
  },
});

/** Traduce errores de dominio y de validación a errores tRPC con mensajes legibles. */
const translateErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof AppError) {
      throw new TRPCError({ code: cause.code, message: cause.message, cause });
    }
    if (cause instanceof z.ZodError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: cause.issues[0]?.message ?? "Datos inválidos",
        cause,
      });
    }
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(translateErrors);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Iniciá sesión" });
  const actor: Actor = { type: "user", userId: ctx.user.id, clientId: ctx.clientId };
  return next({ ctx: { user: ctx.user, actor } });
});
