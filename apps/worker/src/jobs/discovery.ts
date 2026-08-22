import {
  getDb,
  getSettings,
  isAutomationPaused,
  isWithinSendWindow,
  logger,
  type Env,
} from "@prospection/core";
import { runDiscoveryCycle } from "@prospection/discovery";
import type PgBoss from "pg-boss";
import { QUEUES } from "./queues.js";

/**
 * Job de découverte (§7.2) : cron toutes les 25 minutes.
 * Les cycles ne tournent que pendant la fenêtre autorisée (mêmes
 * jours/heures que la fenêtre d'envoi) et hors pause générale —
 * chaque cycle traite de petits lots, l'étalement est donc naturel.
 */
export async function registerDiscoveryJob(boss: PgBoss, env: Env): Promise<void> {
  await boss.work(QUEUES.discovery, async () => {
    const db = getDb(env.DATABASE_URL);
    if (await isAutomationPaused(db)) {
      logger.info("discovery : pause générale active (STOP) — cycle ignoré");
      return;
    }
    const settings = await getSettings(db);
    if (!isWithinSendWindow(settings.sendWindow, settings.timezone)) {
      logger.debug("discovery : hors fenêtre autorisée — cycle reporté");
      return;
    }
    const summary = await runDiscoveryCycle(db, env, {
      onProspectCreated: async (prospectId) => {
        await boss.send(QUEUES.enrichment, { prospectId });
      },
    });
    logger.info({ summary: summary.sources }, "discovery : cycle terminé");
  });

  await boss.schedule(QUEUES.discovery, "*/25 * * * *", undefined, {
    tz: env.TZ,
  });
}
