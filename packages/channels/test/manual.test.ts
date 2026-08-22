import { manualDmQueue, prospects, socialProfiles, type Db } from "@prospection/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateDmForProspect } from "../src/manual.js";
import { createTestDb } from "./helpers/pglite.js";

const deps = {
  personalize: async (input: { prospect: { companyName: string }; channel: string }) => ({
    body: `Message ${input.channel} pour ${input.prospect.companyName}`,
  }),
  senderActivity: "Vidéos courtes",
};

describe("file « À envoyer manuellement » (§7.7)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  async function seed(platforms: ("instagram" | "tiktok" | "facebook" | "youtube")[]) {
    const [p] = await db
      .insert(prospects)
      .values({ companyName: "Bistrot des Halles", discoverySource: "cse_instagram", status: "NOUVEAU" })
      .returning();
    for (const platform of platforms) {
      await db.insert(socialProfiles).values({
        prospectId: p!.id,
        platform,
        profileUrl: `https://www.${platform}.com/bistrot/`,
        source: "cse",
      });
    }
    return p!;
  }

  it("génère un DM pour la meilleure plateforme et le met en file (jamais envoyé)", async () => {
    const p = await seed(["youtube", "instagram"]);
    const result = await generateDmForProspect(db, deps, p.id);
    expect(result).toMatchObject({ queued: true, platform: "instagram" });
    const queue = await db.select().from(manualDmQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.status).toBe("a_envoyer");
    expect(queue[0]!.messageText).toContain("Bistrot des Halles");
  });

  it("idempotent : pas de doublon en file", async () => {
    const p = await seed(["instagram"]);
    await generateDmForProspect(db, deps, p.id);
    const again = await generateDmForProspect(db, deps, p.id);
    expect(again.queued).toBe(false);
    expect(await db.select().from(manualDmQueue)).toHaveLength(1);
  });

  it("aucun profil social → rien en file", async () => {
    const p = await seed([]);
    const result = await generateDmForProspect(db, deps, p.id);
    expect(result).toMatchObject({ queued: false, reason: "aucun profil social" });
  });

  it("prospect déjà contacté ou refus → jamais de DM", async () => {
    const p = await seed(["instagram"]);
    await db.update(prospects).set({ firstContactedAt: new Date() }).where(eq(prospects.id, p.id));
    expect((await generateDmForProspect(db, deps, p.id)).queued).toBe(false);

    await db
      .update(prospects)
      .set({ firstContactedAt: null, status: "PAS_INTERESSE" })
      .where(eq(prospects.id, p.id));
    expect((await generateDmForProspect(db, deps, p.id)).queued).toBe(false);
  });
});
