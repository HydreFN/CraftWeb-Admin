import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, extractJson, type MessagesClient } from "../src/anthropic.js";
import { hasEnoughContext, neutralTemplate } from "../src/templates.js";

function fakeClient(reply: string): MessagesClient & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: reply }] }));
  return { messages: { create }, create } as unknown as MessagesClient & {
    create: ReturnType<typeof vi.fn>;
  };
}

const RICH_PROSPECT = {
  companyName: "Garage Martin",
  niche: "garage",
  city: "Lyon",
  description:
    "Garage indépendant à Lyon : entretien toutes marques, spécialiste véhicules anciens. Restaurations présentées chaque mois.",
};

describe("extractJson (parse robuste)", () => {
  it("parse un JSON nu", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parse un JSON dans des fences markdown", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("parse un JSON entouré de texte", () => {
    expect(extractJson('Voici : {"a":1} — voilà.')).toEqual({ a: 1 });
  });
  it("retourne null si aucun JSON", () => {
    expect(extractJson("désolé, impossible")).toBeNull();
  });
});

describe("AnthropicProvider.personalize", () => {
  it("appelle le modèle avec uniquement les données de la fiche", async () => {
    const client = fakeClient('{"subject":"Vos restaurations en vidéo","body":"Bonjour, j\'ai vu vos restaurations…"}');
    const provider = new AnthropicProvider({ model: "claude-haiku-4-5", client });
    const out = await provider.personalize({
      prospect: RICH_PROSPECT,
      channel: "email",
      kind: "initial",
      senderActivity: "Création de vidéos courtes",
    });
    expect(out.subject).toBe("Vos restaurations en vidéo");
    expect(out.usedFallback).toBeUndefined();
    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      system: string;
      messages: { content: string }[];
    };
    expect(call.system).toContain("INTERDICTION D'INVENTER");
    expect(call.messages[0]!.content).toContain("Garage Martin");
  });

  it("données insuffisantes → template neutre SANS appel API (pas d'invention)", async () => {
    const client = fakeClient("{}");
    const provider = new AnthropicProvider({ client });
    const out = await provider.personalize({
      prospect: { companyName: "Mystère SARL" },
      channel: "email",
      kind: "initial",
      senderActivity: "Création de vidéos courtes",
    });
    expect(out.usedFallback).toBe(true);
    expect(out.body).toContain("Mystère SARL");
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("réponse IA illisible → repli sur le template neutre", async () => {
    const client = fakeClient("je ne peux pas répondre en JSON");
    const provider = new AnthropicProvider({ client });
    const out = await provider.personalize({
      prospect: RICH_PROSPECT,
      channel: "email",
      kind: "initial",
      senderActivity: "Création de vidéos courtes",
    });
    expect(out.usedFallback).toBe(true);
  });

  it("canal social : pas d'objet", async () => {
    const client = fakeClient('{"body":"Salut, super contenu !"}');
    const provider = new AnthropicProvider({ client });
    const out = await provider.personalize({
      prospect: RICH_PROSPECT,
      channel: "instagram",
      kind: "initial",
      senderActivity: "Création de vidéos courtes",
    });
    expect(out.subject).toBeUndefined();
    expect(out.body).toContain("Salut");
  });
});

describe("AnthropicProvider.classify", () => {
  it("retourne {classification, confidence} en JSON strict", async () => {
    const client = fakeClient('{"classification":"DEMANDE_DE_PRIX","confidence":91.4}');
    const provider = new AnthropicProvider({ client });
    const out = await provider.classify({
      conversation: [],
      lastInbound: "Vous proposez quoi comme tarifs ?",
    });
    expect(out.classification).toBe("DEMANDE_DE_PRIX");
    expect(out.confidence).toBe(91);
  });

  it("catégorie inconnue ou JSON cassé → A_VERIFIER, confiance 0", async () => {
    for (const bad of ['{"classification":"SUPER","confidence":99}', "pas du JSON"]) {
      const provider = new AnthropicProvider({ client: fakeClient(bad) });
      const out = await provider.classify({ conversation: [], lastInbound: "??" });
      expect(out.classification).toBe("A_VERIFIER");
      expect(out.confidence).toBe(0);
    }
  });
});

describe("templates neutres", () => {
  it("hasEnoughContext exige une description substantielle", () => {
    expect(
      hasEnoughContext({
        prospect: { companyName: "X" },
        channel: "email",
        kind: "initial",
        senderActivity: "",
      }),
    ).toBe(false);
    expect(
      hasEnoughContext({
        prospect: RICH_PROSPECT,
        channel: "email",
        kind: "initial",
        senderActivity: "",
      }),
    ).toBe(true);
  });

  it("le template email initial reste sobre (pas de mots spam)", () => {
    const out = neutralTemplate({
      prospect: { companyName: "Test", niche: "garage", city: "Lyon" },
      channel: "email",
      kind: "initial",
      senderActivity: "Création de vidéos courtes",
    });
    expect(out.subject).toBeDefined();
    expect(out.subject!.toLowerCase()).not.toMatch(/gratuit|urgent|promo/);
    expect(out.body.split(/\s+/).length).toBeLessThan(130);
  });
});
