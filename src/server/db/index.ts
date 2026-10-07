import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  });

// En desarrollo, el hot reload re-evalúa módulos: reutilizamos el pool.
if (process.env.NODE_ENV === "development") globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });

export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Cualquier cosa sobre la que se pueda ejecutar una query: la base o una transacción. */
export type Executor = DB | Tx;

export { schema };
