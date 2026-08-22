import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const p = new pg.Pool({ connectionString, max: 10 });
  return { db: drizzle(p, { schema }), pool: p };
}

/** Singleton applicatif (web + worker). */
export function getDb(connectionString?: string): Db {
  if (!db) {
    const url = connectionString ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL manquante — impossible d'ouvrir la connexion Postgres.");
    }
    const created = createDb(url);
    db = created.db;
    pool = created.pool;
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export { schema };
