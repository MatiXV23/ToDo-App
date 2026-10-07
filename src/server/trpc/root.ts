import { router } from "./init";
import { aiRouter } from "./routers/ai";
import { automationRouter } from "./routers/automation";
import { githubRouter } from "./routers/github";
import {
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
  automation: automationRouter,
  github: githubRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
