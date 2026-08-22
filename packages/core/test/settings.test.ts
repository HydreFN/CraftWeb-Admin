import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import {
  DEFAULT_SETTINGS,
  getSettings,
  isAutomationPaused,
  setAutomationPaused,
  updateSettings,
} from "../src/services/settings.js";
import { createTestDb } from "./helpers/pglite.js";

describe("settings (table + défauts §10)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("retourne les défauts de la spécification quand rien n'est stocké", async () => {
    const s = await getSettings(db);
    expect(s.automationPaused).toBe(false);
    expect(s.reviewMode).toBe(true); // mode revue ON par défaut
    expect(s.sources.osm).toBe(false); // OSM OFF par défaut
    expect(s.sources.places).toBe(true);
    expect(s.discoveryDailyGlobal).toBe(40);
    expect(s.discoveryDailyPerSource).toBe(10);
    expect(s.emailDailyMax).toBe(30);
    expect(s.relanceDelaiJours).toBe(4);
    expect(s.sendWindow.days).toEqual([1, 2, 3, 4, 5]);
    expect(s.sendWindow.startHour).toBe(9);
    expect(s.sendWindow.startMinute).toBe(30);
    expect(s.sendWindow.endHour).toBe(18);
    expect(s.timezone).toBe("Europe/Paris");
    expect(s.sendIntervalMinMinutes).toBe(6);
    expect(s.sendIntervalMaxMinutes).toBe(18);
    expect(s.aiModel).toBe("claude-haiku-4-5");
  });

  it("persiste un patch et conserve le reste", async () => {
    await updateSettings(db, { emailDailyMax: 12, reviewMode: false });
    const s = await getSettings(db);
    expect(s.emailDailyMax).toBe(12);
    expect(s.reviewMode).toBe(false);
    expect(s.discoveryDailyGlobal).toBe(DEFAULT_SETTINGS.discoveryDailyGlobal);
  });

  it("le bouton STOP est un flag à effet immédiat", async () => {
    expect(await isAutomationPaused(db)).toBe(false);
    await setAutomationPaused(db, true);
    expect(await isAutomationPaused(db)).toBe(true);
    await setAutomationPaused(db, false);
    expect(await isAutomationPaused(db)).toBe(false);
  });
});
