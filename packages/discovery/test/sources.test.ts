import { apiUsage, type Db } from "@prospection/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanTitle, parseProfileUrl } from "../src/sources/cse.js";
import { CseSource } from "../src/sources/cse.js";
import { PlacesSource } from "../src/sources/places.js";
import { YouTubeSource } from "../src/sources/youtube.js";
import { createTestDb } from "./helpers/pglite.js";

const TZ = "Europe/Paris";
const CRITERIA = { country: "FR", city: "Lyon", sector: "garage", keywords: "", sources: [] };

function mockFetchOnce(responses: Record<string, unknown>) {
  const fn = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const match = Object.entries(responses).find(([prefix]) => url.includes(prefix));
    if (!match) throw new Error(`URL inattendue dans le test : ${url}`);
    return new Response(JSON.stringify(match[1]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("sources de découverte (API mockées)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
    vi.unstubAllGlobals();
  });

  it("PlacesSource parse la réponse Text Search et compte l'usage", async () => {
    mockFetchOnce({
      "places.googleapis.com": {
        places: [
          {
            id: "p1",
            displayName: { text: "Garage Martin" },
            formattedAddress: "12 rue X, 69003 Lyon, France",
            websiteUri: "https://garage-martin.fr",
            nationalPhoneNumber: "04 72 00 00 01",
            types: ["car_repair"],
          },
        ],
      },
    });
    const src = new PlacesSource({ apiKey: "k", db, tz: TZ });
    const out = await src.discover(CRITERIA, 5);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      companyName: "Garage Martin",
      websiteUrl: "https://garage-martin.fr",
      phone: "04 72 00 00 01",
    });
    const usage = await db.select().from(apiUsage);
    expect(usage.find((u) => u.key === "places:text_search_pro")?.used).toBe(1);
  });

  it("PlacesSource sans clé API → non configurée, aucune requête", async () => {
    const fetchSpy = mockFetchOnce({});
    const src = new PlacesSource({ apiKey: undefined, db, tz: TZ });
    expect(src.isConfigured()).toBe(false);
    expect(await src.discover(CRITERIA, 5)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("YouTubeSource enchaîne search.list + channels.list et compte 101 unités", async () => {
    mockFetchOnce({
      "/youtube/v3/search": { items: [{ id: { channelId: "UC123" } }] },
      "/youtube/v3/channels": {
        items: [
          {
            id: "UC123",
            snippet: {
              title: "ShinyCar Detailing",
              description: "Detailing premium à Lyon",
              country: "FR",
              customUrl: "@shinycar",
            },
            statistics: { subscriberCount: "12400" },
          },
        ],
      },
    });
    const src = new YouTubeSource({ apiKey: "k", db, tz: TZ });
    const out = await src.discover(CRITERIA, 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.socialProfile).toMatchObject({
      platform: "youtube",
      profileUrl: "https://www.youtube.com/@shinycar",
      username: "shinycar",
      followersCount: 12400,
    });
    const usage = await db.select().from(apiUsage);
    expect(usage.find((u) => u.key === "youtube:units")?.used).toBe(101);
  });

  it("CseSource ne retient que les vraies URL de profil et nettoie les titres", async () => {
    mockFetchOnce({
      "customsearch/v1": {
        items: [
          {
            title: "Garage Martin (@garagemartin) • Instagram photos et vidéos",
            snippet: "Garage indépendant à Lyon…",
            link: "https://www.instagram.com/garagemartin/",
          },
          { title: "Un post", link: "https://www.instagram.com/p/xyz/" },
          { title: "Explore", link: "https://www.instagram.com/explore/tags/garage/" },
        ],
      },
    });
    const src = new CseSource("instagram", { apiKey: "k", cx: "cx1", db, tz: TZ });
    const out = await src.discover(CRITERIA, 10);
    expect(out).toHaveLength(1);
    expect(out[0]!.companyName).toBe("Garage Martin");
    expect(out[0]!.socialProfile?.profileUrl).toBe("https://www.instagram.com/garagemartin/");
  });
});

describe("parseProfileUrl", () => {
  it("instagram : profil oui, post non", () => {
    expect(parseProfileUrl("instagram", "https://www.instagram.com/garagemartin/")).toMatchObject({
      username: "garagemartin",
    });
    expect(parseProfileUrl("instagram", "https://www.instagram.com/p/abc/")).toBeNull();
    expect(parseProfileUrl("instagram", "https://autre-site.fr/garagemartin")).toBeNull();
  });
  it("tiktok : @handle uniquement", () => {
    expect(parseProfileUrl("tiktok", "https://www.tiktok.com/@shinycar")).toMatchObject({
      username: "shinycar",
    });
    expect(parseProfileUrl("tiktok", "https://www.tiktok.com/@shinycar/video/123")).toBeNull();
  });
  it("facebook : page oui, groupe non", () => {
    expect(parseProfileUrl("facebook", "https://www.facebook.com/bistrotdeshalles/")).toMatchObject({
      username: "bistrotdeshalles",
    });
    expect(parseProfileUrl("facebook", "https://www.facebook.com/groups/lyonresto/")).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("retire les décorations de plateforme", () => {
    expect(cleanTitle("Garage Martin (@garagemartin) • Instagram photos et vidéos", "instagram")).toBe(
      "Garage Martin",
    );
    expect(cleanTitle("ShinyCar | TikTok", "tiktok")).toBe("ShinyCar");
  });
});
