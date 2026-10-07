/**
 * Proceso de fondo: consume el outbox de eventos (automatizaciones) y corre tareas
 * periódicas (fechas límite). Se ejecuta aparte de Next: `npm run worker`.
 */
import { startWorker } from "@/server/worker";

startWorker().catch((err) => {
  console.error("[worker] error fatal", err);
  process.exit(1);
});
