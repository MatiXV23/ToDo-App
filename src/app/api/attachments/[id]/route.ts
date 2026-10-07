import { getRequestActor } from "@/server/auth/request-actor";
import { AppError } from "@/server/errors";
import { getAttachmentForDownload } from "@/server/services/attachments";
import { readStoredFile } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Sirve un adjunto a quien pueda ver el proyecto (sesión o token de API). */
export async function GET(req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const actor = await getRequestActor(req);
  if (!actor) return new Response("No autenticado", { status: 401 });
  const { id } = await ctx.params;
  try {
    const row = await getAttachmentForDownload(actor, id);
    const data = await readStoredFile(row.storageKey);
    const download = new URL(req.url).searchParams.has("download");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response("No encontrado", { status: 404 });
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Response("Archivo no disponible", { status: 404 });
    throw err;
  }
}
