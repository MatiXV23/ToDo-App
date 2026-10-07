import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { projectChannel, type RealtimeEnvelope, userChannel } from "@/server/events";
import { AppError } from "@/server/errors";
import { authorize } from "@/server/permissions/access";
import { realtimeHub } from "@/server/realtime/hub";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events. Sin `projectId`: avisos del usuario (buzón, lista de proyectos).
 * Con `projectId`: cambios del proyecto. Los mensajes solo traen ids; los datos se
 * vuelven a pedir por tRPC, que valida permisos.
 */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user) return new Response("No autenticado", { status: 401 });

  const projectId = new URL(req.url).searchParams.get("projectId");
  let channel = userChannel(user.id);
  if (projectId) {
    try {
      await authorize(db, { type: "user", userId: user.id }, projectId, "project.view");
    } catch (err) {
      if (err instanceof AppError) return new Response("No encontrado", { status: 404 });
      throw err;
    }
    channel = projectChannel(projectId);
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send("retry: 3000\n\n");
      const unsubscribe = realtimeHub.subscribe([channel], (message: RealtimeEnvelope) => {
        send(`data: ${JSON.stringify(message)}\n\n`);
      });
      const heartbeat = setInterval(() => send(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
