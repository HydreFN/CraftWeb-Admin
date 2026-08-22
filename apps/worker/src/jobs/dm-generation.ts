import { createAIProvider, neutralTemplate, type PersonalizeInput } from "@prospection/ai";
import { generateDmForProspect } from "@prospection/channels";
import {
  getDb,
  getSettings,
  isAutomationPaused,
  logger,
  manualDmQueue,
  prospects,
  socialProfiles,
  type Env,
} from "@prospection/core";
import { and, eq, isNotNull, notExists } from "drizzle-orm";
import type PgBoss from "pg-boss";
import { QUEUES } from "./queues.js";

/**
 * Génération des messages sociaux (§7.6/7.7) : uniquement la GÉNÉRATION —
 * l'envoi reste 100 % manuel (file « À envoyer manuellement »).
 */
export async function registerDmGenerationJob(boss: PgBoss, env: Env): Promise<void> {
  const db = getDb(env.DATABASE_URL);

  async function handleOne(prospectId: string): Promise<void> {
    if (await isAutomationPaused(db)) return;
    const settings = await getSettings(db);
    const provider = createAIProvider({
      provider: settings.aiProvider,
      model: settings.aiModel,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    });
    const personalize = async (input: PersonalizeInput) => {
      if (!env.ANTHROPIC_API_KEY || settings.aiProvider !== "anthropic") {
        return neutralTemplate(input);
      }
      try {
        return await provider.personalize(input);
      } catch {
        return neutralTemplate(input);
      }
    };
    const result = await generateDmForProspect(
      db,
      { personalize, senderActivity: settings.senderActivity },
      prospectId,
    );
    logger.info({ prospectId, ...result }, "dm-generation");
  }

  await boss.work(QUEUES.dmGeneration, async (jobs: PgBoss.Job<{ prospectId: string }>[]) => {
    for (const job of jobs) {
      if (job.data?.prospectId) await handleOne(job.data.prospectId);
    }
  });

  // Balayage de rattrapage : prospects enrichis sans email principal mais
  // avec profil social et rien en file.
  await boss.work(QUEUES.dmSweep, async () => {
    if (await isAutomationPaused(db)) return;
    const pending = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(
        and(
          eq(prospects.status, "NOUVEAU"),
          isNotNull(prospects.enrichedAt),
          notExists(
            db
              .select({ id: manualDmQueue.id })
              .from(manualDmQueue)
              .where(eq(manualDmQueue.prospectId, prospects.id)),
          ),
        ),
      )
      .limit(10);
    for (const p of pending) {
      // generateDmForProspect vérifie lui-même l'absence d'email/contact
      const hasSocial = await db
        .select({ id: socialProfiles.id })
        .from(socialProfiles)
        .where(eq(socialProfiles.prospectId, p.id))
        .limit(1);
      if (hasSocial.length > 0) await handleOne(p.id);
    }
  });
  await boss.schedule(QUEUES.dmSweep, "*/20 * * * *", undefined, { tz: env.TZ });
}
