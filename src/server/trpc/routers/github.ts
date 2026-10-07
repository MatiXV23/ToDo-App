import * as z from "zod";
import * as repos from "@/server/services/repos";
import { authedProcedure as p, router } from "../init";

const id = z.uuid();

export const githubRouter = router({
  status: p.input(z.object({ projectId: id })).query(({ ctx, input }) => repos.getIntegrationStatus(ctx.actor, input.projectId)),
  availableRepos: p
    .input(z.object({ projectId: id }))
    .query(({ ctx, input }) => repos.listAvailableRepos(ctx.actor, input.projectId)),
  connectRepo: p
    .input(z.object({ projectId: id, installationId: id, externalRepoId: z.string() }))
    .mutation(({ ctx, input }) => repos.connectRepo(ctx.actor, input)),
  disconnectRepo: p
    .input(z.object({ projectRepositoryId: id }))
    .mutation(({ ctx, input }) => repos.disconnectRepo(ctx.actor, input.projectRepositoryId)),
  createBranch: p
    .input(z.object({ taskId: id, projectRepositoryId: id, branch: z.string().min(1).max(200), baseBranch: z.string().max(200).optional() }))
    .mutation(({ ctx, input }) => repos.createBranchForTask(ctx.actor, input)),
  unlink: p.input(z.object({ linkId: id })).mutation(({ ctx, input }) => repos.unlinkVcs(ctx.actor, input.linkId)),
  branchStatus: p.input(z.object({ linkId: id })).query(({ ctx, input }) => repos.getBranchStatus(ctx.actor, input.linkId)),
});
