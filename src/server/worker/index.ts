import { Client } from "pg";
import { pool } from "@/server/db";
import { handleDomainEvent } from "@/server/automations/executor";
import { processPendingEvents } from "./events";
import { runScheduledJobs } from "./scheduler";

const POLL_MS = 5_000;
const SCHEDULE_MS = 60_000;

export async function startWorker() {
  let running = false;
  let again = false;

  // Procesa en serie; si llega otro aviso mientras corre, vuelve a pasar al terminar.
  const drain = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await processPendingEvents(handleDomainEvent);
      } while (again);
    } catch (err) {
      console.error("[worker] error procesando eventos", err);
    } finally {
      running = false;
    }
  };

  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  await listener.query("LISTEN domain_events");
  listener.on("notification", () => void drain());
  listener.on("error", (err) => {
    console.error("[worker] conexión LISTEN perdida", err);
    process.exit(1);
  });

  const poll = setInterval(() => void drain(), POLL_MS);
  const schedule = setInterval(() => {
    runScheduledJobs().catch((err) => console.error("[worker] error en tareas programadas", err));
  }, SCHEDULE_MS);

  console.log("[worker] escuchando eventos");
  await drain();
  void runScheduledJobs().catch((err) => console.error("[worker] error en tareas programadas", err));

  const shutdown = async () => {
    clearInterval(poll);
    clearInterval(schedule);
    await listener.end().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
