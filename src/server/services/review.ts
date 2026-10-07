import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { tasks } from "@/server/db/schema";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { projectChannel, publish } from "@/server/events";
import { type Actor, authorize } from "@/server/permissions/access";
import { logActivity } from "./activity";

/**
 * Aprobación de tareas que llegan por tokens externos (por ejemplo, una app que convierte
 * reportes de usuarios en tareas). Ese contenido no es confiable: hasta que una persona lo lee
 * y aprueba la tarea, el agente no mergea solo sus PRs. Si el token externo vuelve a crear o
 * cambiar contenido, la tarea vuelve a quedar pendiente.
 */

export const isExternalActor = (actor: Actor) => actor.type === "user" && !!actor.external;

/**
 * Deja pendientes de aprobación las tareas que tocó un actor externo, y también sus tareas
 * principales: el agente ve las subtareas como parte de la principal. Va dentro de la
 * transacción del cambio; quien la llama publica el cambio en tiempo real.
 */
export async function requestReviewIfExternal(ex: Executor, actor: Actor, taskIds: string[]) {
  if (!isExternalActor(actor) || taskIds.length === 0) return;
  const parents = await ex
    .select({ parentId: tasks.parentId })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), isNotNull(tasks.parentId)));
  const ids = [...new Set([...taskIds, ...parents.map((p) => p.parentId!)])];
  const changed = await ex
    .update(tasks)
    .set({ reviewStatus: "pending", reviewedById: null, reviewedAt: null })
    .where(and(inArray(tasks.id, ids), or(isNull(tasks.reviewStatus), ne(tasks.reviewStatus, "pending"))))
    .returning({ id: tasks.id, projectId: tasks.projectId });
  await logActivity(
    ex,
    actor,
    changed.map((t) => ({ taskId: t.id, projectId: t.projectId, kind: "review" as const, field: "requested" })),
  );
}

/** Aprueba (o vuelve a dejar pendiente) una tarea. Solo una persona desde la app, nunca un token. */
export async function setTaskApproval(actor: Actor, taskId: string, approved: boolean) {
  if (actor.type !== "user" || actor.via) throw forbidden("Las tareas se aprueban desde la app, no por API");
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .for("update");
    if (!task) throw notFound("Tarea");
    await authorize(tx, actor, task.projectId, "task.update");
    if (!task.reviewStatus) throw badRequest("Esta tarea no necesita aprobación");
    const next = approved ? "approved" : "pending";
    if (task.reviewStatus === next) return;
    await tx
      .update(tasks)
      .set({ reviewStatus: next, reviewedById: approved ? actor.userId : null, reviewedAt: approved ? new Date() : null })
      .where(eq(tasks.id, task.id));
    await logActivity(tx, actor, [
      { taskId: task.id, projectId: task.projectId, kind: "review", field: approved ? "approved" : "revoked" },
    ]);
    await publish(tx, projectChannel(task.projectId), { type: "board", taskIds: [task.id] }, actor);
    await publish(tx, projectChannel(task.projectId), { type: "task", taskId: task.id }, actor);
  });
}
