import * as z from "zod";
import * as agent from "@/server/services/agent";
import { authedProcedure as p, router } from "../init";

export const agentRouter = router({
  settings: p.input(z.object({ projectId: z.uuid() })).query(({ ctx, input }) => agent.getAgentSettings(ctx.actor, input.projectId)),
  update: p.input(agent.agentSettingsSchema).mutation(({ ctx, input }) => agent.updateAgentSettings(ctx.actor, input)),
  requeue: p.input(z.object({ taskId: z.uuid() })).mutation(({ ctx, input }) => agent.requeueTask(ctx.actor, input.taskId)),
});
