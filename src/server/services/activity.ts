import type { Executor } from "@/server/db";
import { taskActivity } from "@/server/db/schema";
import { type Actor, actorRef } from "@/server/permissions/access";

export type ActivityEntry = {
  taskId: string;
  projectId: string;
  kind:
    | "created"
    | "updated"
    | "moved"
    | "deleted"
    | "restored"
    | "linked"
    | "unlinked"
    | "attached"
    | "detached"
    | "agent"
    | "review";
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
};

export async function logActivity(ex: Executor, actor: Actor, entries: ActivityEntry[]) {
  if (entries.length === 0) return;
  await ex.insert(taskActivity).values(
    entries.map((e) => ({
      taskId: e.taskId,
      projectId: e.projectId,
      actorType: actor.type,
      actorId: actorRef(actor),
      kind: e.kind,
      field: e.field ?? null,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      via: actor.type === "user" ? (actor.via ?? null) : null,
    })),
  );
}
