import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import {
  canSendAndConsume,
  effectiveEmailQuota,
  getQuotaUsage,
  releaseQuota,
  warmupCap,
} from "../src/services/quotas.js";
import { createTestDb } from "./helpers/pglite.js";

const TZ = "Europe/Paris";

describe("canSendAndConsume (transactionnel, date locale Europe/Paris)", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("consomme jusqu'au quota puis refuse", async () => {
    const now = new Date("2025-06-17T08:00:00Z");
    for (let i = 0; i < 3; i++) {
      expect(await canSendAndConsume(db, { key: "email", max: 3, tz: TZ, now })).toBe(true);
    }
    expect(await canSendAndConsume(db, { key: "email", max: 3, tz: TZ, now })).toBe(false);
    const usage = await getQuotaUsage(db, "email", TZ, now);
    expect(usage).toEqual({ used: 3, max: 3 });
  });

  it("quota max <= 0 refuse toujours", async () => {
    expect(await canSendAndConsume(db, { key: "email", max: 0, tz: TZ })).toBe(false);
  });

  it("les clés sont indépendantes", async () => {
    const now = new Date("2025-06-17T08:00:00Z");
    expect(await canSendAndConsume(db, { key: "discovery:places", max: 1, tz: TZ, now })).toBe(true);
    expect(await canSendAndConsume(db, { key: "discovery:places", max: 1, tz: TZ, now })).toBe(false);
    expect(await canSendAndConsume(db, { key: "discovery:youtube", max: 1, tz: TZ, now })).toBe(true);
  });

  it("remise à zéro implicite à minuit LOCAL (Paris), pas UTC", async () => {
    // 21:30 UTC le 14 juin = 23:30 à Paris → jour local 2025-06-14
    const before = new Date("2025-06-14T21:30:00Z");
    // 22:30 UTC le 14 juin = 00:30 le 15 juin à Paris → nouveau jour local
    const after = new Date("2025-06-14T22:30:00Z");

    expect(await canSendAndConsume(db, { key: "email", max: 1, tz: TZ, now: before })).toBe(true);
    expect(await canSendAndConsume(db, { key: "email", max: 1, tz: TZ, now: before })).toBe(false);
    // Toujours le même instant UTC-jour mais jour local suivant : quota neuf
    expect(await canSendAndConsume(db, { key: "email", max: 1, tz: TZ, now: after })).toBe(true);
    expect(await canSendAndConsume(db, { key: "email", max: 1, tz: TZ, now: after })).toBe(false);
  });

  it("concurrence : n appels simultanés ne dépassent jamais max", async () => {
    const now = new Date("2025-06-17T08:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 20 }, () => canSendAndConsume(db, { key: "email", max: 5, tz: TZ, now })),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    const usage = await getQuotaUsage(db, "email", TZ, now);
    expect(usage.used).toBe(5);
  });

  it("releaseQuota restitue une unité sans passer sous zéro", async () => {
    const now = new Date("2025-06-17T08:00:00Z");
    await canSendAndConsume(db, { key: "email", max: 2, tz: TZ, now });
    await releaseQuota(db, "email", TZ, now);
    await releaseQuota(db, "email", TZ, now); // ne descend pas sous 0
    const usage = await getQuotaUsage(db, "email", TZ, now);
    expect(usage.used).toBe(0);
  });
});

describe("warm-up", () => {
  it("plafonne ~10/15/22 puis plein régime", () => {
    expect(warmupCap("2025-06-01", "2025-06-01")).toBe(10);
    expect(warmupCap("2025-06-01", "2025-06-07")).toBe(10);
    expect(warmupCap("2025-06-01", "2025-06-08")).toBe(15);
    expect(warmupCap("2025-06-01", "2025-06-14")).toBe(15);
    expect(warmupCap("2025-06-01", "2025-06-15")).toBe(22);
    expect(warmupCap("2025-06-01", "2025-06-22")).toBe(Number.POSITIVE_INFINITY);
  });
  it("sans date de début : premier jour de warm-up", () => {
    expect(warmupCap(null, "2025-06-01")).toBe(10);
  });
  it("quota effectif = min(quota utilisateur, warm-up) ; désactivable", () => {
    expect(effectiveEmailQuota(30, true, "2025-06-01", "2025-06-02")).toBe(10);
    expect(effectiveEmailQuota(8, true, "2025-06-01", "2025-06-02")).toBe(8);
    expect(effectiveEmailQuota(30, true, "2025-06-01", "2025-07-01")).toBe(30);
    expect(effectiveEmailQuota(30, false, "2025-06-01", "2025-06-02")).toBe(30);
  });
});
