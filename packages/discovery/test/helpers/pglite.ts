import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { schema, type Db } from "@prospection/core";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../core/drizzle");

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  return { db: db as unknown as Db, close: () => client.close() };
}
