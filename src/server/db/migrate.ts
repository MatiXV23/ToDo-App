import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";

/** Aplica las migraciones pendientes. Se usa al arrancar en Docker y en los tests. */
export async function runMigrations(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida");
  runMigrations(url)
    .then(() => console.log("Migraciones aplicadas"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
