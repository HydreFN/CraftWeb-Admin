import { contactChannels, prospects, socialProfiles, addExclusion, type Db } from "@prospection/core";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enrichProspect } from "../src/enrichment/enrich.js";
import { classifyEmail, extractEmails, extractSocialLinks } from "../src/enrichment/extract.js";
import { isPathAllowed, parseRobots } from "../src/enrichment/robots.js";
import { createTestDb } from "./helpers/pglite.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, "fixtures/html", name), "utf8");

describe("extraction d'emails (fixtures réalistes)", () => {
  it("trouve le mailto de la page contact et filtre le placeholder", () => {
    const emails = extractEmails(fixture("contact.html"));
    expect(emails).toContain("contact@garage-martin.fr");
    expect(emails).not.toContain("votre@email.fr");
  });

  it("trouve l'email encodé (&#64;) des mentions légales et filtre l'hébergeur", () => {
    const emails = extractEmails(fixture("mentions-legales.html"));
    expect(emails).toContain("paul.martin@garage-martin.fr");
    expect(emails).not.toContain("support@ovh.com");
  });

  it("ignore les faux positifs de la home (logo@2x.png, sentry)", () => {
    expect(extractEmails(fixture("home.html"))).toEqual([]);
  });

  it("priorise générique > service > nominatif", () => {
    expect(classifyEmail("contact@x.fr").priority).toBe(0);
    expect(classifyEmail("reservation@x.fr").priority).toBe(1);
    expect(classifyEmail("paul.martin@x.fr").priority).toBe(2);
  });
});

describe("extraction des liens sociaux", () => {
  it("rattache Instagram/Facebook/YouTube depuis le footer", () => {
    const socials = extractSocialLinks(fixture("home.html"));
    const platforms = socials.map((s) => s.platform).sort();
    expect(platforms).toEqual(["facebook", "instagram", "youtube"]);
  });
});

describe("robots.txt", () => {
  it("respecte les Disallow du groupe *", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\n");
    expect(isPathAllowed(rules, "/contact")).toBe(true);
    expect(isPathAllowed(rules, "/admin/secret")).toBe(false);
    expect(isPathAllowed(rules, "/admin/public/page")).toBe(true);
  });
  it("robots vide → tout est autorisé", () => {
    expect(isPathAllowed(parseRobots(""), "/contact")).toBe(true);
  });
});

describe("enrichProspect (orchestration §7.3)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
  });

  const SITE = "https://www.garage-martin.fr";
  const fetcher = (pages: Record<string, string>) => async (url: string) => {
    const u = new URL(url);
    return pages[u.pathname] ?? null;
  };

  async function createProspect(websiteUrl: string | null = SITE) {
    const [p] = await db
      .insert(prospects)
      .values({
        companyName: "Garage Martin",
        websiteUrl,
        websiteDomain: websiteUrl ? "garage-martin.fr" : null,
        locationCity: "Lyon",
        discoverySource: "places",
      })
      .returning();
    return p!;
  }

  it("visite home + contact + mentions (max 3 pages), sélectionne l'email générique", async () => {
    const p = await createProspect();
    const visited: string[] = [];
    const { outcome, emailsFound } = await enrichProspect(db, p.id, {
      fetchText: async (url) => {
        visited.push(url);
        return fetcher({
          "/": fixture("home.html"),
          "/contact": fixture("contact.html"),
          "/mentions-legales": fixture("mentions-legales.html"),
        })(url);
      },
      hasMx: async () => true,
    });
    expect(outcome).toBe("email_ready");
    expect(emailsFound).toBe(2); // contact@ + paul.martin@
    expect(visited.length).toBeLessThanOrEqual(4); // home + 3 candidats max (dont doublons filtrés)

    const contacts = await db.select().from(contactChannels).where(eq(contactChannels.prospectId, p.id));
    const primary = contacts.find((c) => c.isPrimary);
    expect(primary?.value).toBe("contact@garage-martin.fr");
    expect(primary?.type).toBe("email_generique");

    const socials = await db.select().from(socialProfiles).where(eq(socialProfiles.prospectId, p.id));
    expect(socials.map((s) => s.platform).sort()).toEqual(["facebook", "instagram", "youtube"]);

    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.description).toContain("Garage indépendant à Lyon");
  });

  it("plusieurs candidats sans générique → A_VERIFIER (validation humaine)", async () => {
    const p = await createProspect("https://www.hotel-bellevue.fr");
    const { outcome } = await enrichProspect(db, p.id, {
      fetchText: fetcher({ "/": fixture("ambiguous.html") }),
      hasMx: async () => true,
    });
    expect(outcome).toBe("a_verifier");
    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("A_VERIFIER");
    const contacts = await db.select().from(contactChannels);
    expect(contacts.every((c) => !c.isPrimary)).toBe(true);
  });

  it("MX invalide → email non exploitable (no_email)", async () => {
    const p = await createProspect();
    const { outcome } = await enrichProspect(db, p.id, {
      fetchText: fetcher({ "/contact": fixture("contact.html") }),
      hasMx: async () => false,
    });
    expect(outcome).toBe("no_email");
  });

  it("email présent dans la liste d'exclusion → jamais contactable", async () => {
    await addExclusion(db, "contact@garage-martin.fr", "email", "desinscription");
    const p = await createProspect();
    const { outcome } = await enrichProspect(db, p.id, {
      fetchText: fetcher({ "/contact": fixture("contact.html") }),
      hasMx: async () => true,
    });
    // seul reste paul.martin@ (nominatif unique → sélectionné sans ambiguïté)
    expect(outcome).toBe("no_email");
  });

  it("pas de site web → no_website", async () => {
    const p = await createProspect(null);
    const { outcome } = await enrichProspect(db, p.id, { hasMx: async () => true });
    expect(outcome).toBe("no_website");
  });
});
