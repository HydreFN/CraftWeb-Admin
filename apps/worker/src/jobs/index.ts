import type { Env } from "@prospection/core";
import type PgBoss from "pg-boss";
import { registerDiscoveryJob } from "./discovery.js";
import { registerEmailSequencerJob } from "./email-sequencer.js";
import { registerEnrichmentJob } from "./enrichment.js";
import { QUEUES } from "./queues.js";

/**
 * Enregistrement des jobs. Chaque job vérifie la pause générale (STOP)
 * au début de son exécution — et de nouveau avant tout envoi.
 */
export async function registerJobs(boss: PgBoss, env: Env): Promise<void> {
  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue);
  }
  await registerDiscoveryJob(boss, env);
  await registerEnrichmentJob(boss, env);
  await registerEmailSequencerJob(boss, env);
}
