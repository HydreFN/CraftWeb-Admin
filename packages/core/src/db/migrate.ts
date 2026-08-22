import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { closeDb, getDb } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const env = loadConfig();
  const db = getDb(env.DATABASE_URL);
  const migrationsFolder = path.resolve(here, "../../drizzle");
  console.log(`Application des migrations depuis ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations appliquées ✔");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
