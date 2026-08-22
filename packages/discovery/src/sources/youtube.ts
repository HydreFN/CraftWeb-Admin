import type { Db, DiscoveredBusiness, SearchCriteria } from "@prospection/core";
import { fetchJson } from "../http.js";
import type { DiscoverySource } from "../types.js";
import { trackApiUsage } from "../usage.js";

/**
 * YouTubeSource — API officielle YouTube Data v3.
 * search.list (type=channel) coûte 100 unités ; channels.list coûte 1 unité.
 * Quota : 10 000 unités / jour. Chaque appel incrémente `youtube:units`.
 *
 * NB (§2.2) : l'email « caché » derrière le bouton de la page À propos
 * (protégé par CAPTCHA) n'est JAMAIS récupéré — seuls la description,
 * le nombre d'abonnés et le pays exposés par l'API officielle sont lus.
 */

interface SearchListResponse {
  items?: { id?: { channelId?: string } }[];
}
interface ChannelsListResponse {
  items?: {
    id: string;
    snippet?: { title?: string; description?: string; country?: string; customUrl?: string };
    statistics?: { subscriberCount?: string };
  }[];
}

export class YouTubeSource implements DiscoverySource {
  readonly id = "youtube" as const;

  constructor(
    private readonly opts: { apiKey?: string; db: Db; tz: string; baseUrl?: string },
  ) {}

  isConfigured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  async discover(criteria: SearchCriteria, limit: number): Promise<DiscoveredBusiness[]> {
    if (!this.isConfigured()) return [];
    const q = [criteria.sector, criteria.keywords, criteria.city].filter(Boolean).join(" ").trim();
    if (!q) return [];

    const base = this.opts.baseUrl ?? "https://www.googleapis.com/youtube/v3";
    const search = await fetchJson<SearchListResponse>(
      `${base}/search?${new URLSearchParams({
        key: this.opts.apiKey!,
        part: "snippet",
        type: "channel",
        q,
        maxResults: String(Math.min(Math.max(limit, 1), 25)),
        regionCode: criteria.country || "FR",
      })}`,
    );
    // Une recherche = 100 unités sur les 10 000 quotidiennes
    await trackApiUsage(this.opts.db, "youtube:units", this.opts.tz, 100);

    const channelIds = (search.items ?? [])
      .map((i) => i.id?.channelId)
      .filter((id): id is string => Boolean(id));
    if (channelIds.length === 0) return [];

    const channels = await fetchJson<ChannelsListResponse>(
      `${base}/channels?${new URLSearchParams({
        key: this.opts.apiKey!,
        part: "snippet,statistics",
        id: channelIds.join(","),
      })}`,
    );
    await trackApiUsage(this.opts.db, "youtube:units", this.opts.tz, 1);

    return (channels.items ?? []).slice(0, limit).map((c) => {
      const handle = c.snippet?.customUrl; // ex. "@garagemartin"
      const url = handle
        ? `https://www.youtube.com/${handle}`
        : `https://www.youtube.com/channel/${c.id}`;
      return {
        companyName: c.snippet?.title ?? "Chaîne sans nom",
        niche: criteria.sector || undefined,
        city: criteria.city || undefined,
        country: c.snippet?.country ?? criteria.country ?? "FR",
        description: c.snippet?.description?.slice(0, 1000) || undefined,
        socialProfile: {
          platform: "youtube",
          profileUrl: url,
          username: handle?.replace(/^@/, ""),
          followersCount: c.statistics?.subscriberCount
            ? Number(c.statistics.subscriberCount)
            : undefined,
          bioSnippet: c.snippet?.description?.slice(0, 300) || undefined,
        },
      } satisfies DiscoveredBusiness;
    });
  }
}
