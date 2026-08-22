import {
  contactChannels,
  changeProspectStatus,
  emitEvent,
  isExcluded,
  logEvent,
  normalizeDomain,
  prospects,
  socialProfiles,
  type Db,
} from "@prospection/core";
import { and, eq } from "drizzle-orm";
import dns from "node:dns/promises";
import { USER_AGENT } from "../http.js";
import {
  classifyEmail,
  extractDescription,
  extractEmails,
  extractSocialLinks,
  findContactLinks,
} from "./extract.js";
import { isPathAllowed, parseRobots } from "./robots.js";

export type EnrichOutcome =
  | "email_ready" // email exploitable sélectionné (is_primary)
  | "a_verifier" // plusieurs candidats ambigus → validation humaine
  | "no_email" // aucun email exploitable → canal social / file manuelle
  | "no_website" // pas de site officiel à visiter
  | "not_found"; // prospect inexistant

export interface EnrichDeps {
  /** Récupère le texte d'une URL (null si interdit/inaccessible). Injectable pour les tests. */
  fetchText?: (url: string) => Promise<string | null>;
  /** true si le domaine a un enregistrement MX. Injectable pour les tests. */
  hasMx?: (domain: string) => Promise<boolean>;
}

const MAX_PAGES = 3; // règle §2.9 : maximum 3 pages par site
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 500_000;

/** Fetch HTML avec robots.txt, User-Agent identifiable, timeout court. */
export function makeDefaultFetcher(): (url: string) => Promise<string | null> {
  const robotsCache = new Map<string, ReturnType<typeof parseRobots>>();
  return async (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    let rules = robotsCache.get(parsed.origin);
    if (!rules) {
      try {
        const res = await fetchWithTimeout(`${parsed.origin}/robots.txt`);
        rules = res.ok ? parseRobots(await res.text()) : { disallow: [], allow: [] };
      } catch {
        rules = { disallow: [], allow: [] }; // robots inaccessible ≠ site interdit
      }
      robotsCache.set(parsed.origin, rules);
    }
    if (!isPathAllowed(rules, parsed.pathname)) return null;

    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (type && !type.includes("html") && !type.includes("text")) return null;
      const text = await res.text();
      return text.slice(0, MAX_BODY_BYTES);
    } catch {
      return null;
    }
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.5" },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function defaultHasMx(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

/**
 * Enrichissement (§7.3) : site officiel (home + contact + mentions légales)
 * → emails pro + réseaux + description ; filtres anti-faux-positifs,
 * vérification MX (DNS, gratuit), liste d'exclusion, priorisation
 * générique > service > nominatif, cas ambigus → « À vérifier ».
 */
export async function enrichProspect(
  db: Db,
  prospectId: string,
  deps: EnrichDeps = {},
): Promise<{ outcome: EnrichOutcome; emailsFound: number }> {
  const fetchText = deps.fetchText ?? makeDefaultFetcher();
  const hasMx = deps.hasMx ?? defaultHasMx;

  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!prospect) return { outcome: "not_found", emailsFound: 0 };
  if (!prospect.websiteUrl) return { outcome: "no_website", emailsFound: 0 };

  const base = prospect.websiteUrl;
  const pages: string[] = [];
  const home = await fetchText(base);
  if (home !== null) pages.push(home);

  // Liens contact / mentions légales trouvés sur la home, sinon chemins standards
  const candidates: string[] = [];
  if (home) candidates.push(...findContactLinks(home, base));
  for (const path of ["/contact", "/mentions-legales"]) {
    try {
      candidates.push(new URL(path, base).toString());
    } catch {
      // base invalide
    }
  }
  const visited = new Set([base]);
  for (const url of candidates) {
    if (pages.length >= MAX_PAGES) break;
    if (visited.has(url)) continue;
    visited.add(url);
    const html = await fetchText(url);
    if (html !== null) pages.push(html);
  }

  const allHtml = pages.join("\n");
  const emails = extractEmails(allHtml);
  const socials = extractSocialLinks(allHtml);
  const description = extractDescription(pages[0] ?? "");

  // Réseaux sociaux → social_profiles (source: site_web)
  for (const s of socials) {
    await db
      .insert(socialProfiles)
      .values({
        prospectId,
        platform: s.platform,
        profileUrl: s.profileUrl,
        username: s.username,
        source: "site_web",
      })
      .onConflictDoNothing();
  }
  if (!prospect.description && description) {
    await db
      .update(prospects)
      .set({ description, updatedAt: new Date() })
      .where(eq(prospects.id, prospectId));
  }

  // Emails : exclusion + MX + insertion en contact_channels
  const mxCache = new Map<string, boolean>();
  const usable: { email: string; kind: ReturnType<typeof classifyEmail>; mxValid: boolean }[] = [];
  for (const email of emails) {
    if (await isExcluded(db, email)) continue;
    const domain = email.split("@")[1]!;
    let mxValid = mxCache.get(domain);
    if (mxValid === undefined) {
      mxValid = await hasMx(domain);
      mxCache.set(domain, mxValid);
    }
    const kind = classifyEmail(email);
    usable.push({ email, kind, mxValid });
    await db
      .insert(contactChannels)
      .values({
        prospectId,
        type: kind.kind,
        value: email,
        priority: kind.priority,
        mxValid,
        verifiedAt: new Date(),
        sourceUrl: base,
      })
      .onConflictDoNothing();
  }

  const valid = usable.filter((u) => u.mxValid).sort((a, b) => a.kind.priority - b.kind.priority);
  let outcome: EnrichOutcome;
  if (valid.length === 0) {
    outcome = "no_email";
  } else {
    const best = valid[0]!;
    const tied = valid.filter((v) => v.kind.priority === best.kind.priority);
    const ambiguous = best.kind.priority > 0 && tied.length > 1;
    if (ambiguous) {
      // Plusieurs candidats sans email générique → choix humain (page À vérifier)
      await changeProspectStatus(db, prospectId, "A_VERIFIER", "systeme");
      await logEvent(db, "enrichment", `Choix d'email ambigu pour ${prospect.companyName}`, {
        prospectId,
        candidates: tied.map((t) => t.email),
      });
      outcome = "a_verifier";
    } else {
      await db
        .update(contactChannels)
        .set({ isPrimary: true })
        .where(and(eq(contactChannels.prospectId, prospectId), eq(contactChannels.value, best.email)));
      outcome = "email_ready";
    }
  }

  await db
    .update(prospects)
    .set({ enrichedAt: new Date(), updatedAt: new Date() })
    .where(eq(prospects.id, prospectId));
  await emitEvent(db, "prospect.enriched", {
    prospectId,
    outcome,
    emailsFound: usable.length,
    socialsFound: socials.length,
  });
  await logEvent(db, "enrichment", `Enrichissement ${prospect.companyName} : ${outcome}`, {
    prospectId,
    emails: usable.map((u) => u.email),
  });

  return { outcome, emailsFound: usable.length };
}
