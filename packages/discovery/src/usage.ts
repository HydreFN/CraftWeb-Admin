import {
  apiUsage,
  localMonthString,
  logEvent,
  type Db,
} from "@prospection/core";
import { and, eq, sql } from "drizzle-orm";

/**
 * Compteurs internes d'usage API (§2.8) avec alerte AVANT dépassement
 * des paliers gratuits. Les seuils sont volontairement prudents et
 * documentés — à ajuster si Google change ses paliers.
 */
export const FREE_TIER_LIMITS: Record<string, { limit: number; note: string }> = {
  // Places API (New) : le palier gratuit mensuel est limité ; les champs
  // websiteUri / nationalPhoneNumber relèvent du SKU "Text Search Pro"
  // facturé au-delà du seuil gratuit mensuel (voir README).
  "places:text_search_pro": {
    limit: 5000,
    note: "Requêtes Text Search (Pro) / mois — champs site web + téléphone facturés au-delà du palier gratuit",
  },
  // Programmable Search JSON API : 100 requêtes / jour gratuites,
  // comptées ici au mois (~3000) pour l'alerte de tendance.
  "cse:requests": { limit: 3000, note: "Requêtes Programmable Search / mois (100/jour gratuites)" },
  // YouTube Data API : 10 000 unités / JOUR (une recherche = 100 unités).
  // Compté au mois pour la tendance ; la limite dure est journalière.
  "youtube:units": { limit: 300000, note: "Unités YouTube / mois (limite réelle : 10 000/jour)" },
};

/** Incrémente un compteur mensuel et journalise une alerte à 80 % et 100 %. */
export async function trackApiUsage(
  db: Db,
  key: string,
  tz: string,
  amount = 1,
): Promise<{ used: number; limit: number | null; nearLimit: boolean }> {
  const month = localMonthString(tz);
  await db
    .insert(apiUsage)
    .values({ monthLocale: month, key, used: amount })
    .onConflictDoUpdate({
      target: [apiUsage.monthLocale, apiUsage.key],
      set: { used: sql`${apiUsage.used} + ${amount}` },
    });
  const rows = await db
    .select()
    .from(apiUsage)
    .where(and(eq(apiUsage.monthLocale, month), eq(apiUsage.key, key)));
  const used = rows[0]?.used ?? amount;
  const tier = FREE_TIER_LIMITS[key];
  if (!tier) return { used, limit: null, nearLimit: false };

  const ratio = used / tier.limit;
  const crossed80 = ratio >= 0.8 && (used - amount) / tier.limit < 0.8;
  const crossed100 = ratio >= 1 && (used - amount) / tier.limit < 1;
  if (crossed80 || crossed100) {
    await logEvent(
      db,
      "api-usage",
      crossed100
        ? `🚨 Palier gratuit dépassé pour ${key} : ${used}/${tier.limit} ce mois-ci`
        : `⚠️ Usage API ${key} à ${Math.round(ratio * 100)} % du palier gratuit (${used}/${tier.limit})`,
      { key, used, limit: tier.limit, note: tier.note },
      crossed100 ? "error" : "warn",
    );
  }
  return { used, limit: tier.limit, nearLimit: ratio >= 0.8 };
}

export async function getMonthlyUsage(db: Db, tz: string) {
  const month = localMonthString(tz);
  const rows = await db.select().from(apiUsage).where(eq(apiUsage.monthLocale, month));
  return rows.map((r) => ({
    key: r.key,
    used: r.used,
    limit: FREE_TIER_LIMITS[r.key]?.limit ?? null,
    note: FREE_TIER_LIMITS[r.key]?.note ?? null,
  }));
}
