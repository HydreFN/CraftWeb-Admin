import {
  contactChannels,
  getDb,
  isAutomationPaused,
  logger,
  prospects,
  type Env,
} from "@prospection/core";
import { enrichProspect } from "@prospection/discovery";
import { and, eq, isNull, notExists } from "drizzle-orm";
import type PgBoss from "pg-boss";
import { QUEUES } from "./queues.js";

interface EnrichmentPayload {
  prospectId: string;
}

/**
 * Job d'enrichissement (§7.3) : site officiel → email pro + réseaux.
 * - déclenché à la découverte (message ciblé)
 * - + balayage de rattrapage toutes les 15 min pour les fiches NOUVEAU
 *   jamais enrichies (enriched_at IS NULL)
 * Routage : email exploitable → séquenceur email ; sinon → génération DM.
 */
export async function registerEnrichmentJob(boss: PgBoss, env: Env): Promise<void> {
  const db = getDb(env.DATABASE_URL);

  async function handleOne(prospectId: string): Promise<void> {
    if (await isAutomationPaused(db)) {
      logger.info("enrichment : pause générale (STOP) — reporté");
      return;
    }
    const { outcome } = await enrichProspect(db, prospectId);
    logger.info({ prospectId, outcome }, "enrichment terminé");
    if (outcome === "email_ready") {
      await boss.send(QUEUES.emailSequencer, { prospectId });
    } else if (outcome === "no_email" || outcome === "no_website") {
      await boss.send(QUEUES.dmGeneration, { prospectId });
    }
  }

  await boss.work(QUEUES.enrichment, async (jobs: PgBoss.Job<EnrichmentPayload>[]) => {
    for (const job of jobs) {
      if (job.data?.prospectId) await handleOne(job.data.prospectId);
    }
  });

  // Balayage de rattrapage : fiches NOUVEAU jamais enrichies
  await boss.work(QUEUES.enrichmentSweep, async () => {
    if (await isAutomationPaused(db)) return;
    const pending = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(
        and(
          eq(prospects.status, "NOUVEAU"),
          isNull(prospects.enrichedAt),
          notExists(
            db
              .select({ id: contactChannels.id })
              .from(contactChannels)
              .where(eq(contactChannels.prospectId, prospects.id)),
          ),
        ),
      )
      .limit(5);
    for (const p of pending) {
      await handleOne(p.id);
    }
  });
  await boss.schedule(QUEUES.enrichmentSweep, "*/15 * * * *", undefined, { tz: env.TZ });
}
