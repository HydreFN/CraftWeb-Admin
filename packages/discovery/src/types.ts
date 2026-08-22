import type { DiscoveredBusiness, SearchCriteria } from "@prospection/core";

/**
 * Contrat d'interface des sources de découverte (§5 de la spécification).
 * L'accès aux données sociales se fait EXCLUSIVEMENT via l'index Google
 * (Programmable Search), l'API officielle YouTube Data v3 et les sites
 * web officiels — jamais par scraping direct des plateformes.
 */
export type DiscoverySourceId =
  | "places"
  | "youtube"
  | "cse_instagram"
  | "cse_tiktok"
  | "cse_facebook"
  | "osm";

export interface DiscoverySource {
  id: DiscoverySourceId;
  /** true si la source est utilisable (clés API présentes). */
  isConfigured(): boolean;
  discover(criteria: SearchCriteria, limit: number): Promise<DiscoveredBusiness[]>;
}
