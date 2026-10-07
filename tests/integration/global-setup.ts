import { Client } from "pg";
import { runMigrations } from "../../src/server/db/migrate";

/** Recrea el esquema de la base de tests y aplica las migraciones una vez por corrida. */
export default async function setup() {
  const url = process.env.DATABASE_URL_TEST ?? "postgres://todoapp:todoapp@localhost:5432/todoapp_test";
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  await runMigrations(url);
}
