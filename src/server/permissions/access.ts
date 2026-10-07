import { and, eq } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { projectMembers } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";
import { type Action, can, type Role } from "./index";

/** Quién ejecuta una operación. Las automatizaciones e integraciones no tienen rol propio. */
export type Actor =
  /**
   * `via`: nombre del token de API cuando la acción viene de la API/MCP.
   * `external`: el token es de una integración externa; lo que crea o cambia queda pendiente de aprobación.
   */
  | { type: "user"; userId: string; clientId?: string | null; via?: string | null; external?: boolean }
  | { type: "automation"; ruleId: string; runId: string; depth: number; chain: string[] }
  | { type: "integration"; provider: string }
  | { type: "system" };

export const systemActor: Actor = { type: "system" };

export function actorUserId(actor: Actor): string | null {
  return actor.type === "user" ? actor.userId : null;
}

/** Id que se guarda en historial y eventos para identificar al actor. */
export function actorRef(actor: Actor): string | null {
  switch (actor.type) {
    case "user":
      return actor.userId;
    case "automation":
      return actor.ruleId;
    case "integration":
      return actor.provider;
    case "system":
      return null;
  }
}

export async function getRole(ex: Executor, projectId: string, userId: string): Promise<Role | null> {
  const [row] = await ex
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/**
 * Verifica que el actor pueda ejecutar `action` en el proyecto.
 * - No miembro: NOT_FOUND (no revelamos que el proyecto existe).
 * - Miembro sin permiso: FORBIDDEN.
 * - Automatizaciones, integraciones y sistema: permitido. Su autorización se valida
 *   al crear la regla o al conectar el repositorio.
 */
export async function authorize(
  ex: Executor,
  actor: Actor,
  projectId: string,
  action: Action,
): Promise<Role | null> {
  if (actor.type !== "user") return null;
  const role = await getRole(ex, projectId, actor.userId);
  if (!role) throw notFound("Proyecto");
  if (!can(role, action)) throw forbidden();
  return role;
}
