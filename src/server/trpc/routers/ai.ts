import * as z from "zod";
import * as ai from "@/server/services/ai";
import { authedProcedure as p, router } from "../init";

const id = z.uuid();

/** Todas las funciones devuelven sugerencias; nada se aplica sin confirmación del usuario. */
export const aiRouter = router({
  status: p.query(() => ai.aiStatus()),
  split: p
    .input(z.object({ taskId: id.optional(), epicId: id.optional() }))
    .mutation(({ ctx, input }) => ai.suggestSplit(ctx.actor, input)),
  description: p
    .input(z.object({ projectId: id, title: z.string().min(1).max(300), note: z.string().max(5000).optional(), current: z.string().max(20_000).optional() }))
    .mutation(({ ctx, input }) => ai.suggestDescription(ctx.actor, input)),
  fields: p.input(z.object({ taskId: id })).mutation(({ ctx, input }) => ai.suggestFields(ctx.actor, input.taskId)),
  summary: p
    .input(z.object({ sprintId: id.optional(), projectId: id.optional() }))
    .mutation(({ ctx, input }) => ai.summarize(ctx.actor, input)),
  parseTasks: p.input(ai.parseTasksInput).mutation(({ ctx, input }) => ai.parseTasks(ctx.actor, input)),
});
