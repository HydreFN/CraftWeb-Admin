import { and, count, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { appLogs, dailyQuotas, events, manualDmQueue, prospects } from "../db/schema.js";
import { emitEvent } from "./events.js";
import { logEvent } from "./logs.js";

/**
 * Housekeeping (§8) :
 *  - purge RGPD mensuelle : prospects contactés SANS réponse ni interaction
 *    depuis 36 mois → suppression (les statistiques agrégées sont conservées
 *    dans un événement). La liste d'exclusion n'est JAMAIS purgée.
 *  - nettoyage des logs anciens
 *  - vérification de cohérence des quotas
 *  - résumé quotidien dans app_logs
 */

export const RGPD_RETENTION_MONTHS = 36;
const LOG_RETENTION_DAYS = 90;

export async function purgeRgpd(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - RGPD_RETENTION_MONTHS);

  // Contactés, aucune réponse (lastInboundAt null), aucune interaction depuis
  const eligible = await db
    .select({ id: prospects.id, source: prospects.discoverySource, status: prospects.status })
    .from(prospects)
    .where(
      and(
        lt(prospects.firstContactedAt, cutoff),
        isNull(prospects.lastInboundAt),
        lt(prospects.updatedAt, cutoff),
      ),
    );
  if (eligible.length === 0) return 0;

  // Statistiques agrégées conservées avant suppression
  const bySource: Record<string, number> = {};
  for (const p of eligible) bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  await emitEvent(db, "prospect.excluded", {
    kind: "purge_rgpd",
    count: eligible.length,
    bySource,
    cutoff: cutoff.toISOString(),
  });

  for (const p of eligible) {
    await db.delete(prospects).where(eq(prospects.id, p.id)); // cascade messages/contacts/profils
  }
  await logEvent(
    db,
    "housekeeping",
    `Purge RGPD : ${eligible.length} prospect(s) sans réponse depuis ${RGPD_RETENTION_MONTHS} mois supprimé(s)`,
    { bySource },
    "warn",
  );
  return eligible.length;
}

export async function cleanOldLogs(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 86400000);
  const deleted = await db
    .delete(appLogs)
    .where(lt(appLogs.createdAt, cutoff))
    .returning({ id: appLogs.id });
  return deleted.length;
}

/** used < 0 ou used > max → corrigé + journalisé. */
export async function checkQuotaConsistency(db: Db): Promise<number> {
  const broken = await db
    .select()
    .from(dailyQuotas)
    .where(sql`${dailyQuotas.used} < 0 OR ${dailyQuotas.used} > ${dailyQuotas.max}`);
  for (const row of broken) {
    const fixed = Math.min(Math.max(row.used, 0), row.max);
    await db.update(dailyQuotas).set({ used: fixed }).where(eq(dailyQuotas.id, row.id));
    await logEvent(
      db,
      "housekeeping",
      `Quota incohérent corrigé : ${row.key} ${row.dateLocale} (${row.used} → ${fixed})`,
      {},
      "warn",
    );
  }
  return broken.length;
}

export async function dailySummary(db: Db): Promise<void> {
  const [total] = await db.select({ n: count() }).from(prospects);
  const byStatus = await db
    .select({ status: prospects.status, n: count() })
    .from(prospects)
    .groupBy(prospects.status);
  const [queue] = await db
    .select({ n: count() })
    .from(manualDmQueue)
    .where(eq(manualDmQueue.status, "a_envoyer"));
  const [pendingEvents] = await db
    .select({ n: count() })
    .from(events)
    .where(isNull(events.processedAt));
  await logEvent(db, "housekeeping", "Résumé quotidien", {
    prospects: total?.n ?? 0,
    parStatut: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
    fileManuelle: queue?.n ?? 0,
    evenementsNonTraites: pendingEvents?.n ?? 0,
  });
}
