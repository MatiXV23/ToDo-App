import { ingestWebhook } from "@/server/services/repos";

export const dynamic = "force-dynamic";

/** Webhooks de proveedores de repositorios (por ahora GitHub). */
export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  const rawBody = await req.text();
  const result = await ingestWebhook(provider, { headers: req.headers, rawBody });
  return new Response(result.message, { status: result.status });
}
