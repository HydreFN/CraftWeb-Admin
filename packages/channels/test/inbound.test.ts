import {
  contactChannels,
  classifications,
  exclusionList,
  messages,
  prospects,
  type Db,
  type Tag,
} from "@prospection/core";
import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectAutoReply,
  detectBounce,
  detectStopIntent,
  parsedMailToInbound,
  processInboundEmail,
  type InboundDeps,
  type ParsedInbound,
} from "../src/inbound.js";
import { createTestDb } from "./helpers/pglite.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadEml(name: string): Promise<ParsedInbound> {
  const raw = fs.readFileSync(path.join(here, "fixtures/emails", name));
  return parsedMailToInbound(await simpleParser(raw));
}

function makeDeps(
  classification: Tag = "INTERESSE",
  confidence = 92,
): InboundDeps & { classifyCalls: number } {
  const state = { classifyCalls: 0 };
  return {
    get classifyCalls() {
      return state.classifyCalls;
    },
    classify: async () => {
      state.classifyCalls++;
      return { classification, confidence };
    },
    draftReply: async () => ({ body: "Brouillon suggéré : merci pour votre retour…" }),
    aiModel: "claude-haiku-4-5",
  };
}

describe("détections sur fixtures .eml", () => {
  it("détecte un hard bounce et son destinataire", async () => {
    const mail = await loadEml("bounce-hard.eml");
    const b = detectBounce(mail);
    expect(b.isBounce).toBe(true);
    expect(b.hard).toBe(true);
    expect(b.failedRecipient).toBe("contact@garage-martin.fr");
  });

  it("détecte une réponse automatique d'absence", async () => {
    const mail = await loadEml("auto-reply.eml");
    expect(detectAutoReply(mail)).toBe(true);
    expect(detectBounce(mail).isBounce).toBe(false);
  });

  it("une vraie réponse humaine n'est ni bounce ni auto-reply", async () => {
    const mail = await loadEml("reply-interested.eml");
    expect(detectAutoReply(mail)).toBe(false);
    expect(detectBounce(mail).isBounce).toBe(false);
  });

  it("détecte les intentions STOP en français", () => {
    expect(detectStopIntent("STOP")).toBe(true);
    expect(detectStopIntent("Merci de ne plus nous contacter.")).toBe(true);
    expect(detectStopIntent("Je souhaite me désinscrire de vos envois")).toBe(true);
    expect(detectStopIntent("arrêtez de nous contacter svp")).toBe(true);
    expect(detectStopIntent("Bonjour, pouvez-vous m'en dire plus ?")).toBe(false);
    expect(detectStopIntent("nous avons un stoppeur de porte à vendre")).toBe(false);
  });
});

describe("processInboundEmail (§7.5)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
    vi.restoreAllMocks();
  });

  async function seedContactedProspect() {
    const [p] = await db
      .insert(prospects)
      .values({
        companyName: "Garage Martin",
        discoverySource: "places",
        status: "EN_ATTENTE",
        firstContactedAt: new Date("2025-06-16T08:00:00Z"),
      })
      .returning();
    await db.insert(contactChannels).values({
      prospectId: p!.id,
      type: "email_generique",
      value: "contact@garage-martin.fr",
      mxValid: true,
      isPrimary: true,
    });
    await db.insert(messages).values({
      prospectId: p!.id,
      direction: "sortant",
      channel: "email",
      subject: "Vos restaurations en video",
      bodyText: "corps initial",
      status: "envoye",
      smtpMessageId: "<initial-1@mondomaine.fr>",
      toAddress: "contact@garage-martin.fr",
      sentAt: new Date("2025-06-16T08:05:00Z"),
    });
    return p!;
  }

  it("rattache par In-Reply-To, classe INTERESSE ≥ 80 et crée un brouillon suggéré", async () => {
    const p = await seedContactedProspect();
    const deps = makeDeps("INTERESSE", 92);
    const result = await processInboundEmail(db, deps, await loadEml("reply-interested.eml"));
    expect(result.outcome).toBe("classified");
    expect(result.classification).toBe("INTERESSE");

    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("INTERESSE");
    expect(updated!.lastInboundAt).not.toBeNull();
    expect(updated!.aiConfidence).toBe(92);

    const rows = await db.select().from(classifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("INTERESSE");

    // Brouillon suggéré : statut brouillon, JAMAIS envoyé automatiquement
    const draft = (await db.select().from(messages)).find((m) => m.status === "brouillon");
    expect(draft).toBeDefined();
    expect(draft!.aiGenerated).toBe(true);
  });

  it("confidence < 80 → A_VERIFIER, aucune action automatique", async () => {
    const p = await seedContactedProspect();
    const result = await processInboundEmail(
      db,
      makeDeps("INTERESSE", 55),
      await loadEml("reply-interested.eml"),
    );
    expect(result.outcome).toBe("a_verifier");
    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("A_VERIFIER");
    // pas de brouillon créé
    expect((await db.select().from(messages)).find((m) => m.status === "brouillon")).toBeUndefined();
  });

  it("STOP → PAS_INTERESSE + exclusion permanente SANS appel IA", async () => {
    const p = await seedContactedProspect();
    const deps = makeDeps();
    const result = await processInboundEmail(db, deps, await loadEml("reply-stop.eml"));
    expect(result.outcome).toBe("stop_exclusion");
    expect(deps.classifyCalls).toBe(0);

    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("PAS_INTERESSE");
    const excl = await db.select().from(exclusionList);
    expect(excl.some((e) => e.value === "contact@garage-martin.fr" && e.reason === "desinscription")).toBe(true);
  });

  it("hard bounce → EMAIL_INVALIDE + mx_valid=false + exclusion bounce_hard, pas de classification", async () => {
    const p = await seedContactedProspect();
    const deps = makeDeps();
    const result = await processInboundEmail(db, deps, await loadEml("bounce-hard.eml"));
    expect(result.outcome).toBe("bounce_hard");
    expect(deps.classifyCalls).toBe(0);

    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("EMAIL_INVALIDE");
    const [contact] = await db.select().from(contactChannels);
    expect(contact!.mxValid).toBe(false);
    const excl = await db.select().from(exclusionList);
    expect(excl.some((e) => e.reason === "bounce_hard")).toBe(true);
    // lastInboundAt n'est PAS mis à jour par un bounce
    expect(updated!.lastInboundAt).toBeNull();
  });

  it("réponse automatique : marquée, exclue des stats, pas de classification, relance décalée", async () => {
    const p = await seedContactedProspect();
    const deps = makeDeps();
    const result = await processInboundEmail(db, deps, await loadEml("auto-reply.eml"));
    expect(result.outcome).toBe("auto_reply");
    expect(deps.classifyCalls).toBe(0);

    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("EN_ATTENTE"); // inchangé
    expect(updated!.lastInboundAt).toBeNull(); // hors stats de réponse
    const inbound = (await db.select().from(messages)).find((m) => m.direction === "entrant");
    expect(inbound!.isAutoReply).toBe(true);
  });

  it("expéditeur inconnu → ignoré proprement", async () => {
    const deps = makeDeps();
    const mail = await loadEml("reply-interested.eml");
    mail.inReplyTo = null;
    mail.references = null;
    mail.fromAddress = "inconnu@ailleurs.fr";
    const result = await processInboundEmail(db, deps, mail);
    expect(result.outcome).toBe("ignored_unknown_sender");
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("PAS_INTERESSE classé ≥ 80 → exclusion permanente (refus)", async () => {
    await seedContactedProspect();
    const result = await processInboundEmail(
      db,
      makeDeps("PAS_INTERESSE", 95),
      await loadEml("reply-interested.eml"),
    );
    expect(result.outcome).toBe("classified");
    const excl = await db.select().from(exclusionList);
    expect(excl.some((e) => e.reason === "refus_reponse")).toBe(true);
  });
});
