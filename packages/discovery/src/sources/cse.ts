import type { Db, DiscoveredBusiness, Platform, SearchCriteria } from "@prospection/core";
import { fetchJson } from "../http.js";
import type { DiscoverySource, DiscoverySourceId } from "../types.js";
import { trackApiUsage } from "../usage.js";

/**
 * CseSource — Google Programmable Search JSON API (index Google).
 * Un moteur (CX) par plateforme, restreint à instagram.com / tiktok.com /
 * facebook.com. On parse titre, extrait et URL de profil depuis l'INDEX
 * Google — les plateformes elles-mêmes ne sont JAMAIS requêtées (§2.1).
 * 100 requêtes / jour gratuites (compteur `cse:requests`).
 */

interface CseResponse {
  items?: { title?: string; snippet?: string; link?: string }[];
}

const PROFILE_PATTERNS: Record<
  "instagram" | "tiktok" | "facebook",
  { host: RegExp; extract: (url: URL) => string | null; exclude: RegExp }
> = {
  instagram: {
    host: /(^|\.)instagram\.com$/,
    // https://www.instagram.com/{username}/ (pas /p/, /reel/, /explore/…)
    extract: (url) => {
      const seg = url.pathname.split("/").filter(Boolean);
      if (seg.length !== 1) return null;
      return seg[0] ?? null;
    },
    exclude: /^(p|reel|reels|explore|stories|accounts|tv)$/i,
  },
  tiktok: {
    host: /(^|\.)tiktok\.com$/,
    // https://www.tiktok.com/@{username}
    extract: (url) => {
      const seg = url.pathname.split("/").filter(Boolean);
      const first = seg[0];
      if (!first || !first.startsWith("@") || seg.length > 1) return null;
      return first.slice(1);
    },
    exclude: /^(discover|tag|music|video)$/i,
  },
  facebook: {
    host: /(^|\.)facebook\.com$/,
    // https://www.facebook.com/{pagename}/ (pas /groups/, /events/…)
    extract: (url) => {
      const seg = url.pathname.split("/").filter(Boolean);
      if (seg.length !== 1) return null;
      return seg[0] ?? null;
    },
    exclude: /^(groups|events|marketplace|watch|people|pages|profile\.php|public|hashtag|share|reel)$/i,
  },
};

export class CseSource implements DiscoverySource {
  readonly id: DiscoverySourceId;
  private readonly platform: "instagram" | "tiktok" | "facebook";

  constructor(
    platform: "instagram" | "tiktok" | "facebook",
    private readonly opts: {
      apiKey?: string;
      cx?: string;
      db: Db;
      tz: string;
      baseUrl?: string;
    },
  ) {
    this.platform = platform;
    this.id = `cse_${platform}` as DiscoverySourceId;
  }

  isConfigured(): boolean {
    return Boolean(this.opts.apiKey && this.opts.cx);
  }

  async discover(criteria: SearchCriteria, limit: number): Promise<DiscoveredBusiness[]> {
    if (!this.isConfigured()) return [];
    const q = [criteria.sector, criteria.keywords, criteria.city].filter(Boolean).join(" ").trim();
    if (!q) return [];

    const base = this.opts.baseUrl ?? "https://www.googleapis.com/customsearch/v1";
    const data = await fetchJson<CseResponse>(
      `${base}?${new URLSearchParams({
        key: this.opts.apiKey!,
        cx: this.opts.cx!,
        q,
        num: String(Math.min(Math.max(limit, 1), 10)),
        hl: "fr",
      })}`,
    );
    await trackApiUsage(this.opts.db, "cse:requests", this.opts.tz);

    const results: DiscoveredBusiness[] = [];
    const seen = new Set<string>();
    for (const item of data.items ?? []) {
      if (!item.link) continue;
      const parsed = parseProfileUrl(this.platform, item.link);
      if (!parsed || seen.has(parsed.canonicalUrl)) continue;
      seen.add(parsed.canonicalUrl);
      results.push({
        companyName: cleanTitle(item.title, this.platform) || parsed.username,
        niche: criteria.sector || undefined,
        city: criteria.city || undefined,
        country: criteria.country || "FR",
        socialProfile: {
          platform: this.platform as Platform,
          profileUrl: parsed.canonicalUrl,
          username: parsed.username,
          bioSnippet: item.snippet?.slice(0, 300),
        },
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}

export function parseProfileUrl(
  platform: "instagram" | "tiktok" | "facebook",
  link: string,
): { username: string; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const spec = PROFILE_PATTERNS[platform];
  if (!spec.host.test(url.hostname)) return null;
  const username = spec.extract(url);
  if (!username || spec.exclude.test(username)) return null;
  const canonical =
    platform === "tiktok"
      ? `https://www.tiktok.com/@${username}`
      : platform === "instagram"
        ? `https://www.instagram.com/${username}/`
        : `https://www.facebook.com/${username}/`;
  return { username, canonicalUrl: canonical };
}

/** « Garage Martin (@garagemartin) • Instagram photos » → « Garage Martin » */
export function cleanTitle(title: string | undefined, platform: string): string {
  if (!title) return "";
  return title
    .replace(/\s*[(（]@[^)）]*[)）]/g, "")
    .replace(new RegExp(`\\s*[|•·–-]\\s*${platform}.*$`, "i"), "")
    .replace(/\s*[|•·–-]\s*(instagram|tiktok|facebook)\b.*$/i, "")
    .replace(/\s*photos et vidéos.*$/i, "")
    .trim();
}
