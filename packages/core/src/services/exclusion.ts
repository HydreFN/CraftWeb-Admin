import { and, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { exclusionList } from "../db/schema.js";
import { emailDomain, normalizeEmail } from "../normalize.js";

export type ExclusionReason = "desinscription" | "refus_reponse" | "bounce_hard" | "manuel";

/**
 * Liste d'exclusion permanente (obligation légale d'honorer l'opposition).
 * Jamais purgée. Vérifiée avant tout envoi ET à la découverte/enrichissement.
 */

export async function addExclusion(
  db: Db,
  value: string,
  scope: "email" | "domaine",
  reason: ExclusionReason,
): Promise<void> {
  const normalized = scope === "email" ? (normalizeEmail(value) ?? value.toLowerCase()) : value.toLowerCase();
  await db
    .insert(exclusionList)
    .values({ value: normalized, scope, reason })
    .onConflictDoNothing();
}

/** true si l'email (ou son domaine) figure dans la liste d'exclusion. */
export async function isExcluded(db: Db, email: string): Promise<boolean> {
  const norm = normalizeEmail(email);
  if (!norm) return true; // email invalide → jamais contactable
  const domain = emailDomain(norm);
  const rows = await db
    .select({ id: exclusionList.id })
    .from(exclusionList)
    .where(
      or(
        and(eq(exclusionList.scope, "email"), eq(exclusionList.value, norm)),
        domain
          ? and(eq(exclusionList.scope, "domaine"), eq(exclusionList.value, domain))
          : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** true si le domaine figure dans la liste d'exclusion. */
export async function isDomainExcluded(db: Db, domain: string): Promise<boolean> {
  const rows = await db
    .select({ id: exclusionList.id })
    .from(exclusionList)
    .where(and(eq(exclusionList.scope, "domaine"), eq(exclusionList.value, domain.toLowerCase())))
    .limit(1);
  return rows.length > 0;
}

/** Filtre une liste d'emails : retourne ceux qui ne sont PAS exclus. */
export async function filterExcluded(db: Db, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const normalized = emails
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => e !== null);
  const domains = [...new Set(normalized.map((e) => emailDomain(e)).filter((d): d is string => !!d))];
  const excludedRows = await db
    .select()
    .from(exclusionList)
    .where(
      or(
        and(eq(exclusionList.scope, "email"), inArray(exclusionList.value, normalized)),
        domains.length > 0
          ? and(eq(exclusionList.scope, "domaine"), inArray(exclusionList.value, domains))
          : undefined,
      ),
    );
  const excludedEmails = new Set(
    excludedRows.filter((r) => r.scope === "email").map((r) => r.value),
  );
  const excludedDomains = new Set(
    excludedRows.filter((r) => r.scope === "domaine").map((r) => r.value),
  );
  return normalized.filter((e) => {
    const d = emailDomain(e);
    return !excludedEmails.has(e) && (!d || !excludedDomains.has(d));
  });
}
