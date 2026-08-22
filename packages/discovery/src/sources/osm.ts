import type { DiscoveredBusiness, SearchCriteria } from "@prospection/core";
import { fetchJson } from "../http.js";
import type { DiscoverySource } from "../types.js";

/**
 * OsmSource (option, désactivée par défaut) — Overpass API (OpenStreetMap).
 * Recherche par ville les objets nommés portant un tag shop/amenity/craft
 * correspondant au secteur, et ne retient que ceux exposant un site web
 * ou un téléphone (données publiques contributives, licence ODbL).
 */

const SECTOR_TO_OSM: Record<string, string[]> = {
  garage: ['["shop"="car_repair"]', '["amenity"="car_repair"]'],
  detailing: ['["shop"="car_repair"]', '["amenity"="car_wash"]'],
  restaurant: ['["amenity"="restaurant"]'],
  barbier: ['["shop"="hairdresser"]'],
  "salle de sport": ['["leisure"="fitness_centre"]'],
  "agence immobilière": ['["office"="estate_agent"]'],
  "location auto": ['["amenity"="car_rental"]'],
  hôtel: ['["tourism"="hotel"]'],
  artisan: ['["craft"]'],
  "commerce local": ['["shop"]'],
};

interface OverpassResponse {
  elements?: {
    id: number;
    tags?: Record<string, string>;
  }[];
}

export class OsmSource implements DiscoverySource {
  readonly id = "osm" as const;

  constructor(private readonly opts: { enabled: boolean; baseUrl?: string }) {}

  isConfigured(): boolean {
    return this.opts.enabled;
  }

  async discover(criteria: SearchCriteria, limit: number): Promise<DiscoveredBusiness[]> {
    if (!this.isConfigured() || !criteria.city) return [];
    const selectors = SECTOR_TO_OSM[criteria.sector.toLowerCase()] ?? ['["shop"]'];
    const filters = selectors
      .map((sel) => `nwr(area.a)${sel}["name"];`)
      .join("\n  ");
    const query = `
[out:json][timeout:20];
area["name"="${criteria.city.replace(/"/g, "")}"]["boundary"="administrative"]->.a;
(
  ${filters}
);
out tags ${Math.min(limit * 4, 100)};`;

    const base = this.opts.baseUrl ?? "https://overpass-api.de/api/interpreter";
    const data = await fetchJson<OverpassResponse>(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    }, 25000);

    const results: DiscoveredBusiness[] = [];
    for (const el of data.elements ?? []) {
      const t = el.tags ?? {};
      const website = t.website ?? t["contact:website"];
      const phone = t.phone ?? t["contact:phone"];
      if (!t.name || (!website && !phone)) continue; // uniquement des fiches exploitables
      results.push({
        companyName: t.name,
        niche: criteria.sector || undefined,
        city: criteria.city,
        country: criteria.country || "FR",
        websiteUrl: website,
        phone,
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}
