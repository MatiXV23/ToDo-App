import { sql } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { domainEvents } from "@/server/db/schema";
import { type Actor, actorRef } from "@/server/permissions/access";

/** Eventos que pueden disparar automatizaciones. */
export const DOMAIN_EVENT_TYPES = [
  "task.created",
  "task.moved",
  "branch.created",
  "pr.opened",
  "pr.merged",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/**
 * Registra un evento en el outbox, dentro de la misma transacción que el cambio.
 * El worker lo procesa después (automatizaciones). NOTIFY solo se entrega al hacer commit.
 */
export async function emitDomainEvent(
  ex: Executor,
  input: {
    projectId: string;
    type: DomainEventType;
    taskId?: string | null;
    actor: Actor;
    payload?: Record<string, unknown>;
  },
) {
  const { actor } = input;
  const [row] = await ex
    .insert(domainEvents)
    .values({
      projectId: input.projectId,
      type: input.type,
      taskId: input.taskId ?? null,
      actorType: actor.type,
      actorId: actorRef(actor),
      payload: input.payload ?? {},
      depth: actor.type === "automation" ? actor.depth : 0,
      ruleChain: actor.type === "automation" ? actor.chain : [],
    })
    .returning({ id: domainEvents.id });
  await ex.execute(sql`select pg_notify('domain_events', ${String(row.id)})`);
  return row.id;
}

// ─── Tiempo real ────────────────────────────────────────────────────────

export const projectChannel = (projectId: string) => `project:${projectId}`;
export const userChannel = (userId: string) => `user:${userId}`;

export type RealtimeMessage =
  /** Algo del tablero cambió; taskIds ayuda a refrescar solo lo necesario. */
  | { type: "board"; taskIds?: string[] }
  | { type: "task"; taskId: string }
  | { type: "project" }
  /** Nuevas ejecuciones o cambios en reglas de automatización. */
  | { type: "automation" }
  | { type: "notification" }
  | { type: "projects" };

export type RealtimeEnvelope = RealtimeMessage & { channel: string; origin?: string | null };

/** Publica un mensaje a los navegadores suscriptos. Se entrega al hacer commit. */
export async function publish(
  ex: Executor,
  channel: string,
  message: RealtimeMessage,
  actor?: Actor,
) {
  const origin = actor?.type === "user" ? (actor.clientId ?? null) : null;
  const envelope: RealtimeEnvelope = { ...message, channel, origin };
  await ex.execute(sql`select pg_notify('realtime', ${JSON.stringify(envelope)})`);
}
