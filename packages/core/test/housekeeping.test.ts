import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { appLogs, dailyQuotas, exclusionList, prospects } from "../src/db/schema.js";
import { addExclusion } from "../src/services/exclusion.js";
import {
  checkQuotaConsistency,
  cleanOldLogs,
  purgeRgpd,
} from "../src/services/housekeeping.js";
import { createTestDb } from "./helpers/pglite.js";

const NOW = new Date("2025-06-17T08:00:00Z");
const YEARS_4 = new Date("2021-06-01T08:00:00Z");
const MONTHS_2 = new Date("2025-04-17T08:00:00Z");

describe("housekeeping (§8)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("purge RGPD : contactés sans réponse depuis 36 mois, et EUX SEULS", async () => {
    await db.insert(prospects).values([
      {
        companyName: "Vieux sans réponse",
        discoverySource: "places",
        status: "EN_ATTENTE",
        firstContactedAt: YEARS_4,
        updatedAt: YEARS_4,
      },
      {
        companyName: "Vieux avec réponse",
        discoverySource: "places",
        status: "INTERESSE",
        firstContactedAt: YEARS_4,
        lastInboundAt: YEARS_4,
        updatedAt: YEARS_4,
      },
      {
        companyName: "Récent sans réponse",
        discoverySource: "places",
        status: "EN_ATTENTE",
        firstContactedAt: MONTHS_2,
        updatedAt: MONTHS_2,
      },
      {
        companyName: "Jamais contacté",
        discoverySource: "places",
        status: "NOUVEAU",
      },
    ]);
    const purged = await purgeRgpd(db, NOW);
    expect(purged).toBe(1);
    const remaining = (await db.select().from(prospects)).map((p) => p.companyName).sort();
    expect(remaining).toEqual(["Jamais contacté", "Récent sans réponse", "Vieux avec réponse"]);
  });

  it("la liste d'exclusion n'est JAMAIS purgée", async () => {
    await addExclusion(db, "vieux@refus.fr", "email", "desinscription");
    await db
      .update(exclusionList)
      .set({ createdAt: new Date("2019-01-01T00:00:00Z") });
    await purgeRgpd(db, NOW);
    await cleanOldLogs(db, NOW);
    expect(await db.select().from(exclusionList)).toHaveLength(1);
  });

  it("nettoie les logs de plus de 90 jours", async () => {
    await db.insert(appLogs).values([
      { scope: "t", message: "vieux", createdAt: new Date("2025-01-01T00:00:00Z") },
      { scope: "t", message: "récent", createdAt: NOW },
    ]);
    const deleted = await cleanOldLogs(db, NOW);
    expect(deleted).toBe(1);
    const logs = await db.select().from(appLogs);
    expect(logs.some((l) => l.message === "récent")).toBe(true);
  });

  it("corrige les quotas incohérents", async () => {
    await db.insert(dailyQuotas).values([
      { dateLocale: "2025-06-17", key: "email", used: 99, max: 30 },
      { dateLocale: "2025-06-17", key: "ok", used: 3, max: 30 },
    ]);
    const fixed = await checkQuotaConsistency(db);
    expect(fixed).toBe(1);
    const rows = await db.select().from(dailyQuotas);
    expect(rows.find((r) => r.key === "email")?.used).toBe(30);
    expect(rows.find((r) => r.key === "ok")?.used).toBe(3);
  });
});
