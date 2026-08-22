import {
  addExclusion,
  contactChannels,
  getQuotaUsage,
  getSettings,
  messages,
  prospects,
  setAutomationPaused,
  updateSettings,
  type Db,
} from "@prospection/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasComplianceFooter } from "../src/compliance.js";
import {
  approveMessage,
  planInitialEmails,
  planRelances,
  rejectMessage,
  sendDueEmails,
  type SequencerDeps,
} from "../src/sequencer.js";
import { createTestDb } from "./helpers/pglite.js";

// Mardi 17 juin 2025, 10:00 à Paris (fenêtre lun-ven 09h30-18h00)
const NOW = new Date("2025-06-17T08:00:00Z");

function makeDeps(overrides: Partial<SequencerDeps> = {}) {
  const sends: { to: string; subject?: string; body: string; inReplyTo?: string }[] = [];
  const deps: SequencerDeps = {
    personalize: async (input) => ({
      subject: input.kind === "initial" ? `Idée pour ${input.prospect.companyName}` : undefined,
      body:
        input.kind === "relance"
          ? "Je me permets de revenir vers vous suite à mon premier message."
          : `Bonjour, j'ai découvert ${input.prospect.companyName} et j'aurais une idée adaptée.`,
    }),
    sendEmail: async (msg) => {
      sends.push(msg);
      return { ok: true, smtpMessageId: `<test-${sends.length}@local>` };
    },
    compliance: {
      senderName: "Jean Test",
      senderActivity: "Création de vidéos courtes",
    },
    aiModel: "claude-haiku-4-5",
    now: () => NOW,
    random: () => 0.5,
    ...overrides,
  };
  return { deps, sends };
}

async function seedProspect(db: Db, name = "Garage Martin", email = "contact@garage-martin.fr") {
  const [p] = await db
    .insert(prospects)
    .values({
      companyName: name,
      niche: "garage",
      locationCity: "Lyon",
      description: "Garage indépendant, spécialiste véhicules anciens, restaurations présentées chaque mois.",
      discoverySource: "places",
      status: "NOUVEAU",
    })
    .returning();
  await db.insert(contactChannels).values({
    prospectId: p!.id,
    type: "email_generique",
    value: email,
    mxValid: true,
    isPrimary: true,
  });
  return p!;
}

describe("séquenceur email (§7.4)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });
  afterEach(async () => {
    await close();
    vi.useRealTimers();
  });

  it("mode revue (défaut ON) : l'email généré attend la validation humaine", async () => {
    await seedProspect(db);
    const { deps } = makeDeps();
    expect(await planInitialEmails(db, deps)).toBe(1);
    const [msg] = await db.select().from(messages);
    expect(msg!.status).toBe("en_attente_revue");
    expect(msg!.scheduledAt).toBeNull();
    expect(hasComplianceFooter(msg!.bodyText)).toBe(true);
    expect(msg!.bodyText).toContain("STOP");
  });

  it("mode revue OFF : planification directe dans la fenêtre, avec jitter", async () => {
    await updateSettings(db, { reviewMode: false });
    await seedProspect(db, "Garage Martin", "c1@a.fr");
    await seedProspect(db, "Carrosserie Dupont", "c2@b.fr");
    const { deps } = makeDeps();
    expect(await planInitialEmails(db, deps)).toBe(2);
    const msgs = await db.select().from(messages);
    const times = msgs.map((m) => m.scheduledAt!.getTime()).sort((a, b) => a - b);
    expect(times[0]).toBeGreaterThanOrEqual(NOW.getTime());
    // Étalement : au moins l'intervalle minimum (6 min) entre deux envois
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(6 * 60000);
  });

  it("un seul message sortant actif par prospect (index unique partiel)", async () => {
    await seedProspect(db);
    const { deps } = makeDeps();
    await planInitialEmails(db, deps);
    // Re-planification : le prospect a déjà un sortant → rien de nouveau
    expect(await planInitialEmails(db, deps)).toBe(0);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it("envoi : verrou atomique, statut EN_ATTENTE, first_contacted_at, warm-up démarré", async () => {
    await updateSettings(db, { reviewMode: false });
    const p = await seedProspect(db);
    const { deps, sends } = makeDeps({ random: () => 0 });
    await planInitialEmails(db, deps);
    const report = await sendDueEmails(db, deps);
    expect(report.sent).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.to).toBe("contact@garage-martin.fr");

    const [msg] = await db.select().from(messages);
    expect(msg!.status).toBe("envoye");
    expect(msg!.smtpMessageId).toBe("<test-1@local>");

    const [updated] = await db.select().from(prospects).where(eq(prospects.id, p.id));
    expect(updated!.status).toBe("EN_ATTENTE");
    expect(updated!.firstContactedAt).not.toBeNull();

    const settings = await getSettings(db);
    expect(settings.warmupStartDate).toBe("2025-06-17");
    expect((await getQuotaUsage(db, "email", "Europe/Paris", NOW)).used).toBe(1);
  });

  it("STOP : aucun envoi quand la pause générale est active", async () => {
    await updateSettings(db, { reviewMode: false });
    await seedProspect(db);
    const { deps, sends } = makeDeps({ random: () => 0 });
    await planInitialEmails(db, deps);
    await setAutomationPaused(db, true);
    const report = await sendDueEmails(db, deps);
    expect(report.stopped).toBe(true);
    expect(sends).toHaveLength(0);
  });

  it("hors fenêtre : rien ne part (samedi)", async () => {
    await updateSettings(db, { reviewMode: false });
    await seedProspect(db);
    const { deps, sends } = makeDeps({ random: () => 0 });
    await planInitialEmails(db, deps);
    const saturday = new Date("2025-06-21T08:00:00Z");
    const report = await sendDueEmails(db, { ...deps, now: () => saturday });
    expect(report.sent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it("quota atteint : reporté au prochain jour ouvré (warm-up min(30, 10) → max 1 ici)", async () => {
    await updateSettings(db, { reviewMode: false, emailDailyMax: 1, warmupEnabled: false });
    await seedProspect(db, "A", "a@a.fr");
    await seedProspect(db, "B", "b@b.fr");
    const { deps, sends } = makeDeps({ random: () => 0 });
    await planInitialEmails(db, deps);
    // Forcer les deux à être dus maintenant
    await db.update(messages).set({ scheduledAt: NOW });
    const report = await sendDueEmails(db, deps);
    expect(report.sent).toBe(1);
    expect(report.rescheduled).toBe(1);
    expect(sends).toHaveLength(1);
    const pending = (await db.select().from(messages)).find((m) => m.status === "planifie");
    // Reporté après minuit local → mercredi dans la fenêtre
    expect(pending!.scheduledAt!.getTime()).toBeGreaterThan(NOW.getTime() + 12 * 3600000);
  });

  it("anti-double-envoi : deux ticks concurrents n'envoient qu'une fois", async () => {
    await updateSettings(db, { reviewMode: false });
    await seedProspect(db);
    const { deps, sends } = makeDeps({ random: () => 0 });
    await planInitialEmails(db, deps);
    await db.update(messages).set({ scheduledAt: NOW });
    await Promise.all([sendDueEmails(db, deps), sendDueEmails(db, deps)]);
    expect(sends).toHaveLength(1);
  });

  it("exclusion au moment T : le message passe en échec sans envoi", async () => {
    await updateSettings(db, { reviewMode: false });
    await seedProspect(db);
    const { deps, sends } = makeDeps({ random: () => 0 });
    await planInitialEmails(db, deps);
    await addExclusion(db, "contact@garage-martin.fr", "email", "desinscription");
    await db.update(messages).set({ scheduledAt: NOW });
    const report = await sendDueEmails(db, deps);
    expect(report.sent).toBe(0);
    expect(sends).toHaveLength(0);
    const [msg] = await db.select().from(messages);
    expect(msg!.status).toBe("echec");
  });

  it("échec SMTP : message en échec, quota restitué", async () => {
    await updateSettings(db, { reviewMode: false });
    await seedProspect(db);
    const { deps } = makeDeps({
      random: () => 0,
      sendEmail: async () => ({ ok: false, error: "connexion refusée" }),
    });
    await planInitialEmails(db, deps);
    await db.update(messages).set({ scheduledAt: NOW });
    const report = await sendDueEmails(db, deps);
    expect(report.failed).toBe(1);
    expect((await getQuotaUsage(db, "email", "Europe/Paris", NOW)).used).toBe(0);
  });

  it("mode revue : valider (avec modification) planifie, rejeter repasse en brouillon", async () => {
    await seedProspect(db);
    const { deps } = makeDeps();
    await planInitialEmails(db, deps);
    const [msg] = await db.select().from(messages);

    await approveMessage(db, msg!.id, { body: "Corps relu et corrigé.\n\nSTOP coordonnées professionnelles RGPD" }, { now: () => NOW, random: () => 0 });
    let [after] = await db.select().from(messages);
    expect(after!.status).toBe("planifie");
    expect(after!.scheduledAt).not.toBeNull();
    expect(after!.bodyText).toContain("Corps relu");

    // Rejet : remettre en attente de revue pour tester
    await db.update(messages).set({ status: "en_attente_revue" });
    await rejectMessage(db, msg!.id);
    [after] = await db.select().from(messages);
    expect(after!.status).toBe("brouillon");
  });
});

describe("relance unique J+4 (§7.4)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await close();
  });

  async function contactedProspect(db2: Db, sentDaysAgo: number, now: Date) {
    const p = await seedProspect(db2);
    await db2
      .update(prospects)
      .set({ status: "EN_ATTENTE", firstContactedAt: new Date(now.getTime() - sentDaysAgo * 86400000) })
      .where(eq(prospects.id, p.id));
    await db2.insert(messages).values({
      prospectId: p.id,
      direction: "sortant",
      channel: "email",
      subject: "Premier contact",
      bodyText: "corps initial",
      sequenceStep: 0,
      status: "envoye",
      toAddress: "contact@garage-martin.fr",
      smtpMessageId: "<initial@local>",
      sentAt: new Date(now.getTime() - sentDaysAgo * 86400000),
    });
    return p;
  }

  it("crée UNE relance à J+4, threadée sur le message initial", async () => {
    vi.setSystemTime(NOW);
    const now = new Date();
    await contactedProspect(db, 4, now);
    const { deps } = makeDeps({ now: () => now });
    expect(await planRelances(db, deps)).toBe(1);
    const relance = (await db.select().from(messages)).find((m) => m.sequenceStep === 1);
    expect(relance).toBeDefined();
    expect(relance!.inReplyTo).toBe("<initial@local>");
    expect(relance!.status).toBe("en_attente_revue"); // mode revue ON

    // Jamais de seconde relance
    expect(await planRelances(db, deps)).toBe(0);
  });

  it("pas de relance avant J+4 (fake timers : avance du temps)", async () => {
    vi.setSystemTime(NOW);
    let now = new Date();
    await contactedProspect(db, 2, now);
    const { deps } = makeDeps({ now: () => new Date() });
    expect(await planRelances(db, deps)).toBe(0);

    // Avance de 3 jours → J+5 : la relance part
    vi.advanceTimersByTime(3 * 86400000);
    now = new Date();
    expect(await planRelances(db, { ...deps, now: () => now })).toBe(1);
  });

  it("jamais de relance après une réponse entrante (lastInboundAt)", async () => {
    vi.setSystemTime(NOW);
    const now = new Date();
    const p = await contactedProspect(db, 5, now);
    await db.update(prospects).set({ lastInboundAt: now }).where(eq(prospects.id, p.id));
    const { deps } = makeDeps({ now: () => now });
    expect(await planRelances(db, deps)).toBe(0);
  });

  it("jamais de relance si PAS_INTERESSE ou exclu", async () => {
    vi.setSystemTime(NOW);
    const now = new Date();
    const p = await contactedProspect(db, 5, now);
    await db.update(prospects).set({ status: "PAS_INTERESSE" }).where(eq(prospects.id, p.id));
    const { deps } = makeDeps({ now: () => now });
    expect(await planRelances(db, deps)).toBe(0);

    await db.update(prospects).set({ status: "EN_ATTENTE" }).where(eq(prospects.id, p.id));
    await addExclusion(db, "contact@garage-martin.fr", "email", "desinscription");
    expect(await planRelances(db, deps)).toBe(0);
  });

  it("une réponse automatique décale la relance sans la supprimer", async () => {
    vi.setSystemTime(NOW);
    const now = new Date();
    const p = await contactedProspect(db, 5, now);
    // Réponse d'absence reçue il y a 1 jour (dans la fenêtre du délai)
    await db.insert(messages).values({
      prospectId: p.id,
      direction: "entrant",
      channel: "email",
      bodyText: "Absent jusqu'au 30 juin",
      status: "recu",
      isAutoReply: true,
      createdAt: new Date(now.getTime() - 86400000),
    });
    const { deps } = makeDeps({ now: () => now });
    expect(await planRelances(db, deps)).toBe(0); // décalée

    // 5 jours plus tard : la relance part
    const later = new Date(now.getTime() + 5 * 86400000);
    expect(await planRelances(db, { ...deps, now: () => later })).toBe(1);
  });

  async function seedProspect(db2: Db) {
    const [p] = await db2
      .insert(prospects)
      .values({
        companyName: "Garage Martin",
        niche: "garage",
        locationCity: "Lyon",
        description: "Garage indépendant, restaurations chaque mois — description suffisante.",
        discoverySource: "places",
        status: "NOUVEAU",
      })
      .returning();
    await db2.insert(contactChannels).values({
      prospectId: p!.id,
      type: "email_generique",
      value: "contact@garage-martin.fr",
      mxValid: true,
      isPrimary: true,
    });
    return p!;
  }
});
