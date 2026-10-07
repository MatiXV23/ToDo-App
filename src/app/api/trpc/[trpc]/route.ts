import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/root";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ headers: req.headers }),
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") console.error(`[trpc] ${path}:`, error.cause ?? error);
    },
  });

export { handler as GET, handler as POST };
