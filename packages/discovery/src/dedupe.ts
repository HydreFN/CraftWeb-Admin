import {
  emitEvent,
  isDomainExcluded,
  isSocialOrAggregatorDomain,
  normalizeCity,
  normalizeDomain,
  normalizePhone,
  prospects,
  socialProfiles,
  type Db,
  type DiscoveredBusiness,
  type DiscoverySourceId,
  type Prospect,
} from "@prospection/core";
import { and, eq, sql } from "drizzle-orm";

export type UpsertResult =
  | { action: "created"; prospectId: string }
  | { action: "merged"; prospectId: string }
  | { action: "excluded" }
  | { action: "invalid" };

/**
 * Déduplication à l'insertion (§6), dans l'ordre :
 *   1. website_domain identique → même prospect
 *   2. sinon phone identique → même prospect
 *   3. sinon similarité forte (pg_trgm) sur le nom + même ville → même prospect
 * Une entreprise trouvée sur plusieurs plateformes = UNE fiche,
 * plusieurs social_profiles (fusion sur la fiche existante).
 * La liste d'exclusion (domaine) est vérifiée dès la découverte.
 */
export async function upsertDiscoveredBusiness(
  db: Db,
  business: DiscoveredBusiness,
  source: DiscoverySourceId,
): Promise<UpsertResult> {
  const name = business.companyName?.trim();
  if (!name) return { action: "invalid" };

  let domain = normalizeDomain(business.websiteUrl);
  if (isSocialOrAggregatorDomain(domain)) domain = null;
  const phone = normalizePhone(business.phone);

  if (domain && (await isDomainExcluded(db, domain))) return { action: "excluded" };

  const existing = await findExisting(db, { domain, phone, name, city: business.city });
  if (existing) {
    await mergeInto(db, existing, business, domain, phone);
    return { action: "merged", prospectId: existing.id };
  }

  let created: Prospect | undefined;
  try {
    [created] = await db
      .insert(prospects)
      .values({
        companyName: name,
        niche: business.niche,
        locationCity: business.city,
        locationCountry: business.country ?? "FR",
        websiteUrl: business.websiteUrl,
        websiteDomain: domain,
        phone,
        description: business.description,
        discoverySource: source,
        status: "NOUVEAU",
      })
      .returning();
  } catch (err) {
    // Course rare : le domaine vient d'être inséré par un autre lot
    // (violation de l'index unique partiel sur website_domain)
    if (!isUniqueViolation(err)) throw err;
  }
  if (!created) {
    const again = await findExisting(db, { domain, phone, name, city: business.city });
    if (!again) return { action: "invalid" };
    await mergeInto(db, again, business, domain, phone);
    return { action: "merged", prospectId: again.id };
  }

  await attachSocialProfile(db, created.id, business);
  await emitEvent(db, "prospect.discovered", {
    prospectId: created.id,
    source,
    companyName: name,
  });
  return { action: "created", prospectId: created.id };
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === "23505");
}

async function findExisting(
  db: Db,
  keys: { domain: string | null; phone: string | null; name: string; city?: string },
): Promise<Prospect | null> {
  if (keys.domain) {
    const byDomain = await db
      .select()
      .from(prospects)
      .where(eq(prospects.websiteDomain, keys.domain))
      .limit(1);
    if (byDomain[0]) return byDomain[0];
  }
  if (keys.phone) {
    const byPhone = await db.select().from(prospects).where(eq(prospects.phone, keys.phone)).limit(1);
    if (byPhone[0]) return byPhone[0];
  }
  const city = normalizeCity(keys.city);
  if (city) {
    // Similarité trigram (pg_trgm) sur le nom + même ville normalisée
    const byName = await db
      .select()
      .from(prospects)
      .where(
        and(
          sql`similarity(lower(${prospects.companyName}), lower(${keys.name})) > 0.55`,
          sql`lower(translate(coalesce(${prospects.locationCity}, ''), 'àâäéèêëîïôöùûüç-', 'aaaeeeeiioouuuc ')) = ${city}`,
        ),
      )
      .limit(1);
    if (byName[0]) return byName[0];
  }
  return null;
}

/** Fusionne les infos découvertes dans la fiche existante (sans écraser). */
async function mergeInto(
  db: Db,
  existing: Prospect,
  business: DiscoveredBusiness,
  domain: string | null,
  phone: string | null,
): Promise<void> {
  const patch: Partial<typeof prospects.$inferInsert> = {};
  if (!existing.websiteUrl && business.websiteUrl && domain) {
    patch.websiteUrl = business.websiteUrl;
    patch.websiteDomain = domain;
  }
  if (!existing.phone && phone) patch.phone = phone;
  if (!existing.description && business.description) patch.description = business.description;
  if (!existing.niche && business.niche) patch.niche = business.niche;
  if (!existing.locationCity && business.city) patch.locationCity = business.city;
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    await db.update(prospects).set(patch).where(eq(prospects.id, existing.id));
  }
  await attachSocialProfile(db, existing.id, business);
}

async function attachSocialProfile(
  db: Db,
  prospectId: string,
  business: DiscoveredBusiness,
): Promise<void> {
  const sp = business.socialProfile;
  if (!sp) return;
  await db
    .insert(socialProfiles)
    .values({
      prospectId,
      platform: sp.platform,
      profileUrl: sp.profileUrl,
      username: sp.username,
      followersCount: sp.followersCount,
      bioSnippet: sp.bioSnippet,
      source: sp.platform === "youtube" ? "youtube_api" : "cse",
    })
    .onConflictDoNothing();
}
