import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { db, pool } from "@/server/db";

beforeEach(async () => {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (tables) await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
});

afterAll(async () => {
  await pool.end();
});
