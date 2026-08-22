import type { Db, DiscoveredBusiness, SearchCriteria } from "@prospection/core";
import { fetchJson } from "../http.js";
import type { DiscoverySource } from "../types.js";
import { trackApiUsage } from "../usage.js";

/**
 * PlacesSource — Google Places API (New), Text Search.
 *
 * ⚠️ Facturation : le field mask demandé inclut `websiteUri` et
 * `nationalPhoneNumber`, qui relèvent du SKU « Text Search Pro » —
 * gratuit jusqu'à un palier mensuel, FACTURÉ au-delà. Chaque requête
 * incrémente le compteur `places:text_search_pro` et une alerte est
 * émise à 80 % du palier (voir usage.ts et l'interface).
 */

interface PlacesTextSearchResponse {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    websiteUri?: string;
    nationalPhoneNumber?: string;
    types?: string[];
  }[];
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.types",
].join(",");

export class PlacesSource implements DiscoverySource {
  readonly id = "places" as const;

  constructor(
    private readonly opts: {
      apiKey?: string;
      db: Db;
      tz: string;
      baseUrl?: string;
    },
  ) {}

  isConfigured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  async discover(criteria: SearchCriteria, limit: number): Promise<DiscoveredBusiness[]> {
    if (!this.isConfigured()) return [];
    const textQuery = [criteria.sector, criteria.keywords, criteria.city]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!textQuery) return [];

    const base = this.opts.baseUrl ?? "https://places.googleapis.com";
    const data = await fetchJson<PlacesTextSearchResponse>(`${base}/v1/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.opts.apiKey!,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "fr",
        maxResultCount: Math.min(Math.max(limit, 1), 20),
      }),
    });
    await trackApiUsage(this.opts.db, "places:text_search_pro", this.opts.tz);

    return (data.places ?? []).slice(0, limit).map((p) => ({
      companyName: p.displayName?.text ?? "Entreprise sans nom",
      niche: criteria.sector || undefined,
      city: criteria.city || extractCity(p.formattedAddress),
      country: criteria.country || "FR",
      websiteUrl: p.websiteUri,
      phone: p.nationalPhoneNumber,
      description: p.types?.length ? `Catégories Google : ${p.types.join(", ")}` : undefined,
    }));
  }
}

/** Best-effort : dernière composante non-code-postal de l'adresse formatée. */
function extractCity(address?: string): string | undefined {
  if (!address) return undefined;
  const parts = address.split(",").map((s) => s.trim());
  const cityPart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return cityPart?.replace(/^\d{4,6}\s*/, "") || undefined;
}
