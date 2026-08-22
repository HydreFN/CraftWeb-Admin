import {
  checkQuotaConsistency,
  cleanOldLogs,
  dailySummary,
  getDb,
  logger,
  purgeRgpd,
  type Env,
} from "@prospection/core";
import type PgBoss from "pg-boss";
import { QUEUES } from "./queues.js";

/**
 * Housekeeping (§8) :
 *  - quotidien (23h50 locale) : résumé + nettoyage logs + cohérence quotas
 *  - mensuel (1er du mois, 04h00) : purge RGPD 36 mois
 * La liste d'exclusion n'est jamais touchée.
 */
export async function registerHousekeepingJob(boss: PgBoss, env: Env): Promise<void> {
  const db = getDb(env.DATABASE_URL);

  await boss.work(QUEUES.housekeeping, async (jobs: PgBoss.Job<{ kind?: string }>[]) => {
    for (const job of jobs) {
      const kind = job.data?.kind ?? "daily";
      if (kind === "monthly") {
        const purged = await purgeRgpd(db);
        logger.info({ purged }, "housekeeping mensuel : purge RGPD");
      } else {
        const logsDeleted = await cleanOldLogs(db);
        const quotasFixed = await checkQuotaConsistency(db);
        await dailySummary(db);
        logger.info({ logsDeleted, quotasFixed }, "housekeeping quotidien");
      }
    }
  });

  await boss.schedule(QUEUES.housekeeping, "50 23 * * *", { kind: "daily" }, { tz: env.TZ });
  await boss.schedule(QUEUES.housekeepingMonthly, "0 4 1 * *", { kind: "monthly" }, { tz: env.TZ });
  await boss.work(QUEUES.housekeepingMonthly, async () => {
    const purged = await purgeRgpd(db);
    logger.info({ purged }, "housekeeping mensuel : purge RGPD");
  });
}
