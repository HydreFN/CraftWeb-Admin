import { addExclusion, prospects, schema, socialProfiles, type Db } from "@prospection/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertDiscoveredBusiness } from "../src/dedupe.js";
import { createTestDb } from "./helpers/pglite.js";

describe("déduplication à l'insertion (§6)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  it("crée une fiche NOUVEAU pour une entreprise inconnue", async () => {
    const r = await upsertDiscoveredBusiness(
      db,
      { companyName: "Garage Martin", websiteUrl: "https://www.garage-martin.fr", city: "Lyon" },
      "places",
    );
    expect(r.action).toBe("created");
    const all = await db.select().from(prospects);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("NOUVEAU");
    expect(all[0]!.websiteDomain).toBe("garage-martin.fr");
  });

  it("fusionne sur le même domaine web (priorité 1)", async () => {
    await upsertDiscoveredBusiness(
      db,
      { companyName: "Garage Martin", websiteUrl: "https://garage-martin.fr" },
      "places",
    );
    const r = await upsertDiscoveredBusiness(
      db,
      {
        companyName: "GARAGE MARTIN AUTOMOBILES SARL",
        websiteUrl: "http://www.garage-martin.fr/contact",
        phone: "04 72 00 00 09",
      },
      "osm",
    );
    expect(r.action).toBe("merged");
    const all = await db.select().from(prospects);
    expect(all).toHaveLength(1);
    // La fusion complète les champs manquants sans écraser
    expect(all[0]!.phone).toBe("+33472000009");
  });

  it("fusionne sur le même téléphone (priorité 2)", async () => {
    await upsertDiscoveredBusiness(
      db,
      { companyName: "Le Bistrot", phone: "04 72 11 22 33", city: "Lyon" },
      "places",
    );
    const r = await upsertDiscoveredBusiness(
      db,
      { companyName: "Bistrot des Halles", phone: "+33 4 72 11 22 33" },
      "osm",
    );
    expect(r.action).toBe("merged");
    expect(await db.select().from(prospects)).toHaveLength(1);
  });

  it("fusionne sur similarité trigram du nom + même ville (priorité 3)", async () => {
    await upsertDiscoveredBusiness(
      db,
      { companyName: "ShinyCar Detailing", city: "Villeurbanne" },
      "youtube",
    );
    const r = await upsertDiscoveredBusiness(
      db,
      { companyName: "Shinycar Détailing", city: "Villeurbanne" },
      "cse_instagram",
    );
    expect(r.action).toBe("merged");
    expect(await db.select().from(prospects)).toHaveLength(1);
  });

  it("ne fusionne PAS deux entreprises au nom similaire dans des villes différentes", async () => {
    await upsertDiscoveredBusiness(db, { companyName: "Garage Central", city: "Lyon" }, "places");
    const r = await upsertDiscoveredBusiness(
      db,
      { companyName: "Garage Central", city: "Marseille" },
      "places",
    );
    expect(r.action).toBe("created");
    expect(await db.select().from(prospects)).toHaveLength(2);
  });

  it("une entreprise sur plusieurs plateformes = une fiche, plusieurs social_profiles", async () => {
    await upsertDiscoveredBusiness(
      db,
      {
        companyName: "ShinyCar",
        city: "Lyon",
        socialProfile: {
          platform: "instagram",
          profileUrl: "https://www.instagram.com/shinycar/",
          username: "shinycar",
        },
      },
      "cse_instagram",
    );
    const r = await upsertDiscoveredBusiness(
      db,
      {
        companyName: "ShinyCar",
        city: "Lyon",
        socialProfile: {
          platform: "tiktok",
          profileUrl: "https://www.tiktok.com/@shinycar",
          username: "shinycar",
        },
      },
      "cse_tiktok",
    );
    expect(r.action).toBe("merged");
    expect(await db.select().from(prospects)).toHaveLength(1);
    expect(await db.select().from(socialProfiles)).toHaveLength(2);
  });

  it("le même profil social n'est pas dupliqué (unique platform+url)", async () => {
    const biz = {
      companyName: "ShinyCar",
      city: "Lyon",
      socialProfile: {
        platform: "instagram" as const,
        profileUrl: "https://www.instagram.com/shinycar/",
      },
    };
    await upsertDiscoveredBusiness(db, biz, "cse_instagram");
    await upsertDiscoveredBusiness(db, biz, "cse_instagram");
    expect(await db.select().from(socialProfiles)).toHaveLength(1);
  });

  it("un domaine social (instagram.com) n'est jamais utilisé comme site officiel", async () => {
    const r = await upsertDiscoveredBusiness(
      db,
      { companyName: "Test", websiteUrl: "https://www.instagram.com/test/" },
      "cse_instagram",
    );
    expect(r.action).toBe("created");
    const all = await db.select().from(prospects);
    expect(all[0]!.websiteDomain).toBeNull();
  });

  it("respecte la liste d'exclusion par domaine dès la découverte", async () => {
    await addExclusion(db, "refus.fr", "domaine", "refus_reponse");
    const r = await upsertDiscoveredBusiness(
      db,
      { companyName: "Refusée", websiteUrl: "https://refus.fr" },
      "places",
    );
    expect(r.action).toBe("excluded");
    expect(await db.select().from(schema.prospects)).toHaveLength(0);
  });
});
