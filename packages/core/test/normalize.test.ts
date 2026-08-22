import { describe, expect, it } from "vitest";
import {
  emailDomain,
  isSocialOrAggregatorDomain,
  normalizeCity,
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
} from "../src/normalize.js";

describe("normalizeDomain", () => {
  it("supprime protocole, www et chemin", () => {
    expect(normalizeDomain("https://www.Garage-Martin.fr/contact?x=1")).toBe("garage-martin.fr");
    expect(normalizeDomain("http://exemple.fr")).toBe("exemple.fr");
    expect(normalizeDomain("exemple.fr/page")).toBe("exemple.fr");
  });
  it("retourne null pour les entrées invalides", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain("pas un domaine")).toBeNull();
  });
});

describe("isSocialOrAggregatorDomain", () => {
  it("détecte les plateformes sociales et agrégateurs", () => {
    expect(isSocialOrAggregatorDomain("instagram.com")).toBe(true);
    expect(isSocialOrAggregatorDomain("linktr.ee")).toBe(true);
    expect(isSocialOrAggregatorDomain("m.facebook.com")).toBe(true);
    expect(isSocialOrAggregatorDomain("garage-martin.fr")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("normalise un numéro français national en E.164", () => {
    expect(normalizePhone("04 72 00 00 01")).toBe("+33472000001");
    expect(normalizePhone("04.72.00.00.01")).toBe("+33472000001");
    expect(normalizePhone("(04) 72-00-00-01")).toBe("+33472000001");
  });
  it("préserve les numéros internationaux", () => {
    expect(normalizePhone("+33 4 72 00 00 01")).toBe("+33472000001");
    expect(normalizePhone("0033472000001")).toBe("+33472000001");
  });
  it("retourne null si inexploitable", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("normalise en minuscules", () => {
    expect(normalizeEmail(" Contact@Exemple.FR ")).toBe("contact@exemple.fr");
  });
  it("rejette les emails invalides", () => {
    expect(normalizeEmail("pas-un-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });
  it("extrait le domaine", () => {
    expect(emailDomain("contact@exemple.fr")).toBe("exemple.fr");
  });
});

describe("normalizeCompanyName / normalizeCity", () => {
  it("retire accents, formes juridiques et ponctuation", () => {
    expect(normalizeCompanyName("SARL Garage Martin & Fils")).toBe("garage martin fils");
    expect(normalizeCompanyName("Société Générale-du-Bâtiment SAS")).toBe("generale du batiment");
  });
  it("normalise les villes", () => {
    expect(normalizeCity("Saint-Étienne")).toBe("saint etienne");
    expect(normalizeCity("")).toBeNull();
  });
});
