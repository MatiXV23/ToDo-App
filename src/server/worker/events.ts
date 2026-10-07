import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { domainEvents } from "@/server/db/schema";

const BATCH = 50;

/**
 * Toma eventos pendientes en orden y los procesa. FOR UPDATE SKIP LOCKED permite
 * correr más de un worker sin procesar dos veces el mismo evento.
 */
export async function processPendingEvents(handler: (event: typeof domainEvents.$inferSelect) => Promise<void> = async () => {}) {
  let processed = 0;
  for (;;) {
    const done = await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(domainEvents)
        .where(isNull(domainEvents.processedAt))
        .orderBy(asc(domainEvents.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!event) return true;
      let error: string | null = null;
      try {
        await handler(event);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error(`[worker] evento ${event.id} (${event.type}) falló`, err);
      }
      await tx
        .update(domainEvents)
        .set({ processedAt: sql`now()`, error })
        .where(eq(domainEvents.id, event.id));
      return false;
    });
    if (done || ++processed >= BATCH * 20) break;
  }
}
