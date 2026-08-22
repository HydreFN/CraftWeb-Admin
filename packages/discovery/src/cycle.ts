import {
  canSendAndConsume,
  getQuotaUsage,
  getSettings,
  logEvent,
  releaseQuota,
  type Db,
  type Env,
  type SearchCriteria,
} from "@prospection/core";
import { upsertDiscoveredBusiness } from "./dedupe.js";
import { CseSource } from "./sources/cse.js";
import { OsmSource } from "./sources/osm.js";
import { PlacesSource } from "./sources/places.js";
import { YouTubeSource } from "./sources/youtube.js";
import type { DiscoverySource } from "./types.js";

export interface CycleSourceSummary {
  source: string;
  found: number;
  created: number;
  merged: number;
  excluded: number;
  skipped?: string;
  error?: string;
}

export interface CycleSummary {
  ran: boolean;
  reason?: string;
  sources: CycleSourceSummary[];
  createdProspectIds: string[];
}

/** Taille de lot par source et par cycle : petits lots étalés dans la journée. */
const BATCH_PER_CYCLE = 5;

export function buildSources(db: Db, env: Env, activeFlags: Record<string, boolean>): DiscoverySource[] {
  const tz = env.TZ;
  return [
    new PlacesSource({ apiKey: env.GOOGLE_MAPS_API_KEY, db, tz }),
    new YouTubeSource({ apiKey: env.YOUTUBE_API_KEY, db, tz }),
    new CseSource("instagram", { apiKey: env.GOOGLE_CSE_API_KEY, cx: env.GOOGLE_CSE_CX_INSTAGRAM, db, tz }),
    new CseSource("tiktok", { apiKey: env.GOOGLE_CSE_API_KEY, cx: env.GOOGLE_CSE_CX_TIKTOK, db, tz }),
    new CseSource("facebook", { apiKey: env.GOOGLE_CSE_API_KEY, cx: env.GOOGLE_CSE_CX_FACEBOOK, db, tz }),
    new OsmSource({ enabled: activeFlags.osm ?? false }),
  ].filter((s) => activeFlags[s.id]);
}

/**
 * Un cycle de découverte (§7.2) :
 * pause générale → quotas discovery:global / discovery:{source} →
 * petits lots → déduplication → fiches NOUVEAU → enrichissement planifié.
 */
export async function runDiscoveryCycle(
  db: Db,
  env: Env,
  opts: {
    criteria?: SearchCriteria;
    onProspectCreated?: (prospectId: string) => Promise<void>;
    sources?: DiscoverySource[]; // injectable pour les tests
  } = {},
): Promise<CycleSummary> {
  const settings = await getSettings(db);
  if (settings.automationPaused && !opts.criteria) {
    return { ran: false, reason: "STOP AUTOMATISATION actif", sources: [], createdProspectIds: [] };
  }

  const criteria: SearchCriteria = opts.criteria ?? {
    country: settings.searchCriteria.country,
    city: settings.searchCriteria.city,
    sector: settings.searchCriteria.sector,
    keywords: settings.searchCriteria.keywords,
    sources: [],
  };
  if (!criteria.city && !criteria.sector && !criteria.keywords) {
    return { ran: false, reason: "Aucun critère de recherche défini", sources: [], createdProspectIds: [] };
  }

  const tz = settings.timezone;
  const sources =
    opts.sources ?? buildSources(db, env, settings.sources as unknown as Record<string, boolean>);

  const summaries: CycleSourceSummary[] = [];
  const createdProspectIds: string[] = [];

  for (const source of sources) {
    const summary: CycleSourceSummary = {
      source: source.id,
      found: 0,
      created: 0,
      merged: 0,
      excluded: 0,
    };
    summaries.push(summary);

    if (!source.isConfigured()) {
      summary.skipped = "clé API absente";
      continue;
    }

    const globalUsage = await getQuotaUsage(db, "discovery:global", tz);
    const globalRemaining = settings.discoveryDailyGlobal - globalUsage.used;
    const srcUsage = await getQuotaUsage(db, `discovery:${source.id}`, tz);
    const srcRemaining = settings.discoveryDailyPerSource - srcUsage.used;
    const batch = Math.min(BATCH_PER_CYCLE, globalRemaining, srcRemaining);
    if (batch <= 0) {
      summary.skipped = "quota du jour atteint";
      continue;
    }

    try {
      const businesses = await source.discover(criteria, batch);
      summary.found = businesses.length;

      for (const business of businesses) {
        // Réserver les quotas AVANT insertion (transactionnel) ; restitués
        // si le prospect s'avère être un doublon/exclu.
        const okGlobal = await canSendAndConsume(db, {
          key: "discovery:global",
          max: settings.discoveryDailyGlobal,
          tz,
        });
        if (!okGlobal) break;
        const okSource = await canSendAndConsume(db, {
          key: `discovery:${source.id}`,
          max: settings.discoveryDailyPerSource,
          tz,
        });
        if (!okSource) {
          await releaseQuota(db, "discovery:global", tz);
          break;
        }

        const result = await upsertDiscoveredBusiness(db, business, source.id);
        if (result.action === "created") {
          summary.created++;
          createdProspectIds.push(result.prospectId);
          if (opts.onProspectCreated) await opts.onProspectCreated(result.prospectId);
        } else {
          if (result.action === "merged") summary.merged++;
          if (result.action === "excluded") summary.excluded++;
          await releaseQuota(db, "discovery:global", tz);
          await releaseQuota(db, `discovery:${source.id}`, tz);
        }
      }
    } catch (err) {
      summary.error = err instanceof Error ? err.message : String(err);
      await logEvent(db, "discovery", `Erreur source ${source.id} : ${summary.error}`, {}, "error");
    }
  }

  const totals = summaries.reduce(
    (acc, s) => ({ created: acc.created + s.created, merged: acc.merged + s.merged }),
    { created: 0, merged: 0 },
  );
  await logEvent(db, "discovery", `Cycle de découverte : ${totals.created} créés, ${totals.merged} fusionnés`, {
    criteria: { city: criteria.city, sector: criteria.sector },
    sources: summaries,
  });

  return { ran: true, sources: summaries, createdProspectIds };
}
