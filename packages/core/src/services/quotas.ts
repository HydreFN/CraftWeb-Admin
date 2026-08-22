import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { dailyQuotas } from "../db/schema.js";
import { daysBetweenLocalDates, localDateString } from "../dates.js";

/**
 * Quotas journaliers transactionnels.
 * La date locale (fuseau configuré) rend la remise à zéro de minuit
 * implicite : chaque jour local a sa propre ligne (date_locale, key).
 */

export interface QuotaCheck {
  key: string; // "email", "discovery:global", "discovery:places", …
  max: number; // quota effectif du jour (warm-up déjà appliqué par l'appelant)
  tz: string;
  now?: Date;
}

/**
 * Consomme 1 unité de quota si possible (SELECT … FOR UPDATE, transactionnel).
 * Retourne true si l'unité a été réservée, false si le quota est atteint.
 * Concurrent-safe : deux appels simultanés ne dépassent jamais `max`.
 */
export async function canSendAndConsume(db: Db, check: QuotaCheck): Promise<boolean> {
  const dateLocale = localDateString(check.tz, check.now ?? new Date());
  if (check.max <= 0) return false;

  return db.transaction(async (tx) => {
    // Ligne du jour créée si absente (concurrence gérée par l'index unique)
    await tx
      .insert(dailyQuotas)
      .values({ dateLocale, key: check.key, used: 0, max: check.max })
      .onConflictDoNothing();

    const rows = await tx
      .select()
      .from(dailyQuotas)
      .where(and(eq(dailyQuotas.dateLocale, dateLocale), eq(dailyQuotas.key, check.key)))
      .for("update");
    const row = rows[0];
    if (!row) return false;

    // Le max peut avoir changé dans les paramètres en cours de journée
    const effectiveMax = check.max;
    if (row.used >= effectiveMax) {
      if (row.max !== effectiveMax) {
        await tx
          .update(dailyQuotas)
          .set({ max: effectiveMax })
          .where(eq(dailyQuotas.id, row.id));
      }
      return false;
    }
    await tx
      .update(dailyQuotas)
      .set({ used: sql`${dailyQuotas.used} + 1`, max: effectiveMax })
      .where(eq(dailyQuotas.id, row.id));
    return true;
  });
}

/** Restitue une unité (ex. envoi finalement annulé après réservation). */
export async function releaseQuota(db: Db, key: string, tz: string, now?: Date): Promise<void> {
  const dateLocale = localDateString(tz, now ?? new Date());
  await db
    .update(dailyQuotas)
    .set({ used: sql`GREATEST(${dailyQuotas.used} - 1, 0)` })
    .where(and(eq(dailyQuotas.dateLocale, dateLocale), eq(dailyQuotas.key, key)));
}

/** Lecture sans consommation. */
export async function getQuotaUsage(
  db: Db,
  key: string,
  tz: string,
  now?: Date,
): Promise<{ used: number; max: number | null }> {
  const dateLocale = localDateString(tz, now ?? new Date());
  const rows = await db
    .select()
    .from(dailyQuotas)
    .where(and(eq(dailyQuotas.dateLocale, dateLocale), eq(dailyQuotas.key, key)));
  const row = rows[0];
  return { used: row?.used ?? 0, max: row?.max ?? null };
}

/**
 * Plafond de warm-up : ~10/jour la 1ʳᵉ semaine, ~15 la 2ᵉ, ~22 la 3ᵉ,
 * puis plein régime (Infinity — le quota utilisateur s'applique seul).
 */
export function warmupCap(warmupStartDate: string | null, todayLocal: string): number {
  if (!warmupStartDate) return 10; // premier jour : le warm-up démarre
  const days = daysBetweenLocalDates(warmupStartDate, todayLocal);
  if (days < 0) return 10;
  if (days < 7) return 10;
  if (days < 14) return 15;
  if (days < 21) return 22;
  return Number.POSITIVE_INFINITY;
}

/** Quota email effectif du jour = min(quota utilisateur, plafond warm-up). */
export function effectiveEmailQuota(
  userMax: number,
  warmupEnabled: boolean,
  warmupStartDate: string | null,
  todayLocal: string,
): number {
  if (!warmupEnabled) return userMax;
  return Math.min(userMax, warmupCap(warmupStartDate, todayLocal));
}
