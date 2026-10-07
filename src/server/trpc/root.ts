import { router } from "./init";
import { agentRouter } from "./routers/agent";
import { aiRouter } from "./routers/ai";
import { automationRouter } from "./routers/automation";
import { githubRouter } from "./routers/github";
import {
  attachmentRouter,
  boardRouter,
  columnRouter,
  commentRouter,
  epicRouter,
  memberRouter,
  notificationRouter,
  projectRouter,
  sprintRouter,
  tagRouter,
  taskRouter,
  tokenRouter,
} from "./routers/core";

export const appRouter = router({
  project: projectRouter,
  member: memberRouter,
  notification: notificationRouter,
  board: boardRouter,
  task: taskRouter,
  comment: commentRouter,
  column: columnRouter,
  tag: tagRouter,
  epic: epicRouter,
  sprint: sprintRouter,
  attachment: attachmentRouter,
  token: tokenRouter,
  automation: automationRouter,
  github: githubRouter,
  ai: aiRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
