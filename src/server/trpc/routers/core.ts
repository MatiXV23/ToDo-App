import * as z from "zod";
import * as apiTokens from "@/server/services/api-tokens";
import * as attachments from "@/server/services/attachments";
import * as board from "@/server/services/board";
import * as columns from "@/server/services/columns";
import * as comments from "@/server/services/comments";
import * as epics from "@/server/services/epics";
import * as members from "@/server/services/members";
import * as notifications from "@/server/services/notifications";
import * as projects from "@/server/services/projects";
import * as sprints from "@/server/services/sprints";
import * as tags from "@/server/services/tags";
import * as tasks from "@/server/services/tasks";
import { authedProcedure as p, router } from "../init";

const id = z.uuid();

export const projectRouter = router({
  list: p.query(({ ctx }) => projects.listMyProjects(ctx.user.id)),
  byKey: p.input(z.object({ key: z.string() })).query(({ ctx, input }) => projects.getProjectByKey(ctx.actor, input.key)),
  create: p.input(projects.createProjectSchema).mutation(({ ctx, input }) => projects.createProject(ctx.actor, input)),
  update: p.input(projects.updateProjectSchema).mutation(({ ctx, input }) => projects.updateProject(ctx.actor, input)),
  setArchived: p
    .input(z.object({ projectId: id, archived: z.boolean() }))
    .mutation(({ ctx, input }) => projects.setArchived(ctx.actor, input.projectId, input.archived)),
  delete: p
    .input(z.object({ projectId: id, confirmKey: z.string() }))
    .mutation(({ ctx, input }) => projects.deleteProject(ctx.actor, input.projectId, input.confirmKey)),
});

export const memberRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => members.listMembers(ctx.actor, input.projectId)),
  invite: p.input(members.inviteSchema).mutation(({ ctx, input }) => members.inviteMember(ctx.actor, input)),
  revokeInvitation: p
    .input(z.object({ invitationId: id }))
    .mutation(({ ctx, input }) => members.revokeInvitation(ctx.actor, input.invitationId)),
  myInvitations: p.query(({ ctx }) => members.listMyInvitations(ctx.user.id)),
  respond: p
    .input(z.object({ invitationId: id, accept: z.boolean() }))
    .mutation(({ ctx, input }) => members.respondInvitation(ctx.actor, input.invitationId, input.accept)),
  changeRole: p
    .input(z.object({ projectId: id, userId: z.string(), role: z.enum(["editor", "viewer"]) }))
    .mutation(({ ctx, input }) => members.changeRole(ctx.actor, input)),
  remove: p
    .input(z.object({ projectId: id, userId: z.string() }))
    .mutation(({ ctx, input }) => members.removeMember(ctx.actor, input)),
});

export const notificationRouter = router({
  list: p.query(({ ctx }) => notifications.listNotifications(ctx.user.id)),
  unreadCount: p.query(({ ctx }) => notifications.unreadCount(ctx.user.id)),
  markRead: p
    .input(z.object({ ids: z.array(id).optional() }))
    .mutation(({ ctx, input }) => notifications.markRead(ctx.user.id, input.ids)),
});

export const boardRouter = router({
  get: p.input(z.object({ projectId: id })).query(({ ctx, input }) => board.getBoard(ctx.actor, input.projectId)),
});

export const taskRouter = router({
  get: p.input(z.object({ taskId: id })).query(({ ctx, input }) => tasks.getTaskDetail(ctx.actor, input.taskId)),
  findId: p
    .input(z.object({ projectId: id, number: z.number().int().positive() }))
    .query(({ ctx, input }) => tasks.findTaskId(ctx.actor, input.projectId, input.number)),
  create: p.input(tasks.createTaskSchema).mutation(({ ctx, input }) => tasks.createTask(ctx.actor, input)),
  update: p.input(tasks.updateTaskSchema).mutation(({ ctx, input }) => tasks.updateTask(ctx.actor, input)),
  move: p.input(tasks.moveTaskSchema).mutation(({ ctx, input }) => tasks.moveTask(ctx.actor, input)),
  delete: p.input(z.object({ taskId: id })).mutation(({ ctx, input }) => tasks.deleteTask(ctx.actor, input.taskId)),
  restore: p.input(z.object({ taskId: id })).mutation(({ ctx, input }) => tasks.restoreTask(ctx.actor, input.taskId)),
});

export const commentRouter = router({
  add: p.input(comments.addCommentSchema).mutation(({ ctx, input }) => comments.addComment(ctx.actor, input)),
  update: p
    .input(z.object({ commentId: id, bodyMd: z.string() }))
    .mutation(({ ctx, input }) => comments.updateComment(ctx.actor, input)),
  delete: p.input(z.object({ commentId: id })).mutation(({ ctx, input }) => comments.deleteComment(ctx.actor, input.commentId)),
});

export const columnRouter = router({
  create: p.input(columns.createColumnSchema).mutation(({ ctx, input }) => columns.createColumn(ctx.actor, input)),
  update: p.input(columns.updateColumnSchema).mutation(({ ctx, input }) => columns.updateColumn(ctx.actor, input)),
  move: p
    .input(z.object({ columnId: id, afterColumnId: id.nullable() }))
    .mutation(({ ctx, input }) => columns.moveColumn(ctx.actor, input)),
  delete: p
    .input(z.object({ columnId: id, moveTasksTo: id }))
    .mutation(({ ctx, input }) => columns.deleteColumn(ctx.actor, input)),
});

export const tagRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => tags.listTags(ctx.actor, input.projectId)),
  create: p.input(tags.createTagSchema).mutation(({ ctx, input }) => tags.createTag(ctx.actor, input)),
  update: p.input(tags.updateTagSchema).mutation(({ ctx, input }) => tags.updateTag(ctx.actor, input)),
  delete: p.input(z.object({ tagId: id })).mutation(({ ctx, input }) => tags.deleteTag(ctx.actor, input.tagId)),
});

export const epicRouter = router({
  list: p.input(z.object({ projectId: id })).query(({ ctx, input }) => epics.listEpics(ctx.actor, input.projectId)),
  get: p.input(z.object({ epicId: id })).query(({ ctx, input }) => epics.getEpic(ctx.actor, input.epicId)),
  create: p.input(epics.createEpicSchema).mutation(({ ctx, input }) => epics.createEpic(ctx.actor, input)),
  update: p.input(epics.updateEpicSchema).mutation(({ ctx, input }) => epics.updateEpic(ctx.actor, input)),
  delete: p.input(z.object({ epicId: id })).mutation(({ ctx, input }) => epics.deleteEpic(ctx.actor, input.epicId)),
});

export const sprintRouter = router({
  backlog: p.input(z.object({ projectId: id })).query(({ ctx, input }) => sprints.getBacklog(ctx.actor, input.projectId)),
  create: p.input(sprints.createSprintSchema).mutation(({ ctx, input }) => sprints.createSprint(ctx.actor, input)),
  update: p.input(sprints.updateSprintSchema).mutation(({ ctx, input }) => sprints.updateSprint(ctx.actor, input)),
  start: p
    .input(z.object({ sprintId: id, startDate: z.iso.date().nullish(), endDate: z.iso.date().nullish() }))
    .mutation(({ ctx, input }) => sprints.startSprint(ctx.actor, input)),
  complete: p.input(sprints.completeSprintSchema).mutation(({ ctx, input }) => sprints.completeSprint(ctx.actor, input)),
  delete: p.input(z.object({ sprintId: id })).mutation(({ ctx, input }) => sprints.deleteSprint(ctx.actor, input.sprintId)),
  moveTask: p.input(sprints.moveInBacklogSchema).mutation(({ ctx, input }) => sprints.moveInBacklog(ctx.actor, input)),
});

export const attachmentRouter = router({
  delete: p
    .input(z.object({ attachmentId: id }))
    .mutation(({ ctx, input }) => attachments.deleteAttachment(ctx.actor, input.attachmentId)),
});

export const tokenRouter = router({
  list: p.query(({ ctx }) => apiTokens.listApiTokens(ctx.user.id)),
  create: p.input(apiTokens.createTokenSchema).mutation(({ ctx, input }) => apiTokens.createApiToken(ctx.user.id, input)),
  revoke: p.input(z.object({ tokenId: id })).mutation(({ ctx, input }) => apiTokens.revokeApiToken(ctx.user.id, input.tokenId)),
});
