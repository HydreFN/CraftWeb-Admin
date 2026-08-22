import {
  getQuotaUsage,
  loadConfig,
  prospects,
  updateSettings,
  type Db,
  type DiscoveredBusiness,
} from "@prospection/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDiscoveryCycle } from "../src/cycle.js";
import type { DiscoverySource } from "../src/types.js";
import { createTestDb } from "./helpers/pglite.js";

const ENV = loadConfig({
  DATABASE_URL: "postgres://x:x@localhost:5432/x",
  AUTH_SECRET: "secret-de-test-suffisant",
} as NodeJS.ProcessEnv);

function fakeSource(id: string, businesses: DiscoveredBusiness[]): DiscoverySource {
  return {
    id: id as DiscoverySource["id"],
    isConfigured: () => true,
    discover: async (_c, limit) => businesses.slice(0, limit),
  };
}

const CRITERIA = { country: "FR", city: "Lyon", sector: "garage", keywords: "", sources: [] };

describe("runDiscoveryCycle (§7.2)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("respecte la pause générale (STOP)", async () => {
    await updateSettings(db, { automationPaused: true });
    const summary = await runDiscoveryCycle(db, ENV, {
      sources: [fakeSource("places", [{ companyName: "X" }])],
    });
    expect(summary.ran).toBe(false);
    expect(summary.reason).toContain("STOP");
    expect(await db.select().from(prospects)).toHaveLength(0);
  });

  it("crée des fiches et consomme les quotas global + par source", async () => {
    await updateSettings(db, {
      searchCriteria: { country: "FR", city: "Lyon", sector: "garage", keywords: "" },
    });
    const biz = ["Garage Martin", "Carrosserie Dupont", "Pneus Rapid Service"].map((n) => ({ companyName: n, city: "Lyon" }));
    const summary = await runDiscoveryCycle(db, ENV, {
      criteria: CRITERIA,
      sources: [fakeSource("places", biz)],
    });
    expect(summary.ran).toBe(true);
    expect(summary.sources[0]).toMatchObject({ created: 3, merged: 0 });
    expect((await getQuotaUsage(db, "discovery:global", "Europe/Paris")).used).toBe(3);
    expect((await getQuotaUsage(db, "discovery:places", "Europe/Paris")).used).toBe(3);
  });

  it("s'arrête au quota global et restitue les unités des doublons", async () => {
    await updateSettings(db, { discoveryDailyGlobal: 2, discoveryDailyPerSource: 10 });
    const biz = ["Garage Martin", "Carrosserie Dupont", "Pneus Rapid Service", "Bistrot des Halles"].map((n) => ({ companyName: n, city: "Lyon" }));
    const summary = await runDiscoveryCycle(db, ENV, {
      criteria: CRITERIA,
      sources: [fakeSource("places", biz)],
    });
    expect(summary.sources[0]!.created).toBe(2);
    expect(await db.select().from(prospects)).toHaveLength(2);

    // Un doublon ne consomme pas de quota (quota global relevé pour le vérifier)
    await updateSettings(db, { discoveryDailyGlobal: 10 });
    const again = await runDiscoveryCycle(db, ENV, {
      criteria: CRITERIA,
      sources: [fakeSource("osm", [{ companyName: "Garage Martin", city: "Lyon" }])],
    });
    expect(again.sources[0]!.merged).toBe(1);
    expect((await getQuotaUsage(db, "discovery:osm", "Europe/Paris")).used).toBe(0);
  });

  it("appelle onProspectCreated pour planifier l'enrichissement", async () => {
    const created: string[] = [];
    await runDiscoveryCycle(db, ENV, {
      criteria: CRITERIA,
      sources: [fakeSource("places", [{ companyName: "Garage Neuf", city: "Lyon" }])],
      onProspectCreated: async (id) => {
        created.push(id);
      },
    });
    expect(created).toHaveLength(1);
  });

  it("sans critères : ne fait rien avec un motif explicite", async () => {
    const summary = await runDiscoveryCycle(db, ENV, {});
    expect(summary.ran).toBe(false);
    expect(summary.reason).toContain("critère");
  });
});
