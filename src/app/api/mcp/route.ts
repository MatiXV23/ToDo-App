import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp/server";
import { authenticateApiToken } from "@/server/services/api-tokens";

export const dynamic = "force-dynamic";

/**
 * Servidor MCP (Streamable HTTP, sin estado). Autenticación con token personal:
 *   claude mcp add --transport http todoapp <APP_URL>/api/mcp --header "Authorization: Bearer tda_…"
 */
async function handler(req: Request) {
  const authorization = req.headers.get("authorization");
  const auth = authorization?.startsWith("Bearer ") ? await authenticateApiToken(authorization.slice(7).trim()) : null;
  if (!auth) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Token inválido o ausente. Creá uno en ToDoApp → Tokens de API." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="todoapp"' } },
    );
  }
  const server = createMcpServer({ type: "user", userId: auth.user.id, via: auth.tokenName, external: auth.external });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export { handler as GET, handler as POST, handler as DELETE };
