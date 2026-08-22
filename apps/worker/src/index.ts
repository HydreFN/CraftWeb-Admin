/**
 * Worker autonome : files d'attente et cron via pg-boss (PostgreSQL, pas de Redis).
 * Chaque job vérifie la pause générale (bouton STOP) avant de travailler.
 */
import { loadConfig, logger } from "@prospection/core";
import PgBoss from "pg-boss";
import { registerJobs } from "./jobs/index.js";

async function main() {
  const env = loadConfig(); // refuse de démarrer si l'environnement est invalide

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
  });

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

  await boss.start();
  logger.info("pg-boss démarré");

  await registerJobs(boss, env);
  logger.info("Jobs enregistrés — worker prêt");

  const shutdown = async () => {
    logger.info("Arrêt du worker…");
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
