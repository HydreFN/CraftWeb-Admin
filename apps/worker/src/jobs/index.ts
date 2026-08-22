import type { Env } from "@prospection/core";
import type PgBoss from "pg-boss";

/**
 * Enregistrement des jobs. Les jobs sont ajoutés au fil des étapes :
 *  - discovery (étape 4)      : découverte de prospects, cron étalé
 *  - enrichment (étape 5)     : site officiel → email pro + réseaux
 *  - email-sequencer (étape 6): planification + envoi des emails
 *  - inbox-watcher (étape 7)  : polling IMAP toutes les 2 minutes
 *  - classifier (étape 7)     : classification IA des réponses
 *  - housekeeping (§8)        : purge RGPD 36 mois, logs, résumé quotidien
 */
export async function registerJobs(boss: PgBoss, env: Env): Promise<void> {
  void boss;
  void env;
  // Les enregistrements concrets arrivent avec chaque étape.
}
