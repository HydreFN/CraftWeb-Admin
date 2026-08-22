import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Base Postgres en mémoire (PGlite) avec le schéma réel appliqué
 * depuis les migrations générées — pour des tests fidèles sans Docker.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });

  const migrationsDir = path.resolve(here, "../../drizzle");
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  return {
    db: db as unknown as Db,
    close: () => client.close(),
  };
}
