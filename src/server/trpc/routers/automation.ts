import * as z from "zod";
import * as automations from "@/server/services/automations";
import { authedProcedure as p, router } from "../init";

const id = z.uuid();

export const automationRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => automations.listRules(ctx.actor, input.projectId)),
  create: p.input(automations.createRuleSchema).mutation(({ ctx, input }) => automations.createRule(ctx.actor, input)),
  update: p.input(automations.updateRuleSchema).mutation(({ ctx, input }) => automations.updateRule(ctx.actor, input)),
  setEnabled: p
    .input(z.object({ ruleId: id, enabled: z.boolean() }))
    .mutation(({ ctx, input }) => automations.setRuleEnabled(ctx.actor, input.ruleId, input.enabled)),
  delete: p.input(z.object({ ruleId: id })).mutation(({ ctx, input }) => automations.deleteRule(ctx.actor, input.ruleId)),
  runs: p
    .input(
      z.object({
        projectId: id,
        ruleId: id.optional(),
        status: z.enum(["success", "skipped", "failed"]).optional(),
        limit: z.number().int().min(1).max(300).optional(),
      }),
    )
    .query(({ ctx, input }) => automations.listRuns(ctx.actor, input)),
});
