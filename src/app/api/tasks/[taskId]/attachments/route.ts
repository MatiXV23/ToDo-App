import { getRequestActor } from "@/server/auth/request-actor";
import { AppError } from "@/server/errors";
import { addAttachment, MAX_ATTACHMENT_BYTES } from "@/server/services/attachments";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { NOT_FOUND: 404, FORBIDDEN: 403, BAD_REQUEST: 400 };

/** Sube una imagen a la tarea (multipart/form-data, campo "file"). Acepta sesión o token de API. */
export async function POST(req: Request, ctx: RouteContext<"/api/tasks/[taskId]/attachments">) {
  const actor = await getRequestActor(req);
  if (!actor) return Response.json({ error: "No autenticado" }, { status: 401 });
  const { taskId } = await ctx.params;

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_ATTACHMENT_BYTES + 64 * 1024) return Response.json({ error: "La imagen supera los 10 MB" }, { status: 413 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return Response.json({ error: "Formulario inválido" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "Falta el archivo" }, { status: 400 });

  try {
    const row = await addAttachment(actor, { taskId, fileName: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ id: row.id, fileName: row.fileName, url: `/api/attachments/${row.id}` }, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: STATUS[err.code] ?? 400 });
    throw err;
  }
}
