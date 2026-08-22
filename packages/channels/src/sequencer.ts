import type { PersonalizeInput, PersonalizeOutput } from "@prospection/ai";
import {
  canSendAndConsume,
  changeProspectStatus,
  contactChannels,
  effectiveEmailQuota,
  emitEvent,
  getSettings,
  isAutomationPaused,
  isExcluded,
  isWithinSendWindow,
  localDateString,
  logEvent,
  messages,
  nextLocalMidnight,
  nextWindowStart,
  prospects,
  releaseQuota,
  updateSettings,
  type AppSettings,
  type Db,
  type MessageSummary,
  type SendResult,
} from "@prospection/core";
import { and, asc, desc, eq, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import { withComplianceFooter, type ComplianceOptions } from "./compliance.js";

/**
 * Moteur email (§7.4) : séquence = email initial (step 0) puis UNE relance
 * (step 1) à J+`relance_delai_jours`, jamais plus. Envois étalés (jitter),
 * fenêtre horaire, warm-up, verrou atomique anti-double-envoi, mode revue.
 */

export interface SequencerDeps {
  personalize: (input: PersonalizeInput) => Promise<PersonalizeOutput>;
  sendEmail: (msg: {
    to: string;
    subject?: string;
    body: string;
    inReplyTo?: string;
  }) => Promise<SendResult>;
  compliance: ComplianceOptions;
  aiModel: string;
  now?: () => Date;
  random?: () => number;
}

const PLAN_BATCH = 10;
const SEND_BATCH = 5;

function jitterMs(settings: AppSettings, random: () => number): number {
  const min = settings.sendIntervalMinMinutes * 60000;
  const max = settings.sendIntervalMaxMinutes * 60000;
  return min + Math.floor(random() * Math.max(max - min, 0));
}

/** Créneau du prochain envoi : étalé après le dernier envoi/planifié, dans la fenêtre. */
export async function computeNextSlot(
  db: Db,
  settings: AppSettings,
  now: Date,
  random: () => number,
): Promise<Date> {
  const [last] = await db
    .select({
      t: sql<string | null>`GREATEST(MAX(${messages.scheduledAt}), MAX(${messages.sentAt}))`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "sortant"),
        eq(messages.channel, "email"),
        inArray(messages.status, ["planifie", "envoi_en_cours", "envoye"]),
      ),
    );
  const lastTime = last?.t ? new Date(last.t).getTime() : 0;
  const candidate = new Date(Math.max(lastTime + jitterMs(settings, random), now.getTime()));
  return nextWindowStart(settings.sendWindow, settings.timezone, candidate);
}

async function generateAndInsert(
  db: Db,
  deps: SequencerDeps,
  opts: {
    prospectId: string;
    toAddress: string;
    step: 0 | 1;
    personalizeInput: PersonalizeInput;
    inReplyTo?: string;
    settings: AppSettings;
    now: Date;
  },
): Promise<string | null> {
  const random = deps.random ?? Math.random;
  let generated: PersonalizeOutput;
  try {
    generated = await deps.personalize(opts.personalizeInput);
  } catch (err) {
    // Fournisseur IA indisponible → l'appelant a déjà un fallback dans
    // personalize ; ici c'est une vraie erreur : on journalise et on saute.
    await logEvent(db, "email-sequencer", `Génération impossible : ${String(err)}`, {
      prospectId: opts.prospectId,
    }, "error");
    return null;
  }

  const body = withComplianceFooter(generated.body, deps.compliance);
  const status = opts.settings.reviewMode ? "en_attente_revue" : "planifie";
  const scheduledAt =
    status === "planifie" ? await computeNextSlot(db, opts.settings, opts.now, random) : null;

  try {
    const [msg] = await db
      .insert(messages)
      .values({
        prospectId: opts.prospectId,
        direction: "sortant",
        channel: "email",
        subject: generated.subject ?? null,
        bodyText: body,
        sequenceStep: opts.step,
        aiGenerated: !generated.usedFallback,
        aiModel: generated.usedFallback ? null : deps.aiModel,
        status,
        scheduledAt,
        toAddress: opts.toAddress,
        inReplyTo: opts.inReplyTo,
      })
      .returning({ id: messages.id });
    return msg?.id ?? null;
  } catch (err) {
    // Index unique partiel : un message sortant actif existe déjà → on saute.
    if (err && typeof err === "object" && "code" in err && err.code === "23505") return null;
    throw err;
  }
}

/** Prospects NOUVEAU avec email principal valide et aucun sortant → email initial. */
export async function planInitialEmails(db: Db, deps: SequencerDeps): Promise<number> {
  const settings = await getSettings(db);
  if (settings.automationPaused) return 0;
  const now = (deps.now ?? (() => new Date()))();

  const ready = await db
    .select({
      prospect: prospects,
      email: contactChannels.value,
    })
    .from(prospects)
    .innerJoin(
      contactChannels,
      and(
        eq(contactChannels.prospectId, prospects.id),
        eq(contactChannels.isPrimary, true),
        eq(contactChannels.mxValid, true),
      ),
    )
    .where(
      and(
        eq(prospects.status, "NOUVEAU"),
        notExists(
          db
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.prospectId, prospects.id), eq(messages.direction, "sortant"))),
        ),
      ),
    )
    .orderBy(asc(prospects.discoveredAt))
    .limit(PLAN_BATCH);

  let planned = 0;
  for (const row of ready) {
    if (await isExcluded(db, row.email)) continue;
    const p = row.prospect;
    const id = await generateAndInsert(db, deps, {
      prospectId: p.id,
      toAddress: row.email,
      step: 0,
      settings,
      now,
      personalizeInput: {
        prospect: {
          companyName: p.companyName,
          niche: p.niche ?? undefined,
          city: p.locationCity ?? undefined,
          country: p.locationCountry ?? undefined,
          description: p.description ?? undefined,
          websiteUrl: p.websiteUrl ?? undefined,
        },
        channel: "email",
        kind: "initial",
        senderActivity: settings.senderActivity,
      },
    });
    if (id) planned++;
  }
  return planned;
}

/** Relance unique à J+delai si EN_ATTENTE, aucun entrant, non exclu (§7.4). */
export async function planRelances(db: Db, deps: SequencerDeps): Promise<number> {
  const settings = await getSettings(db);
  if (settings.automationPaused || !settings.relanceEnabled) return 0;
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - settings.relanceDelaiJours * 86400000);

  // Candidats : EN_ATTENTE, un step 0 envoyé avant le cutoff, aucun step 1,
  // aucun message entrant humain (les réponses automatiques décalent juste).
  const candidates = await db
    .select({ prospect: prospects, initial: messages })
    .from(prospects)
    .innerJoin(
      messages,
      and(
        eq(messages.prospectId, prospects.id),
        eq(messages.direction, "sortant"),
        eq(messages.sequenceStep, 0),
        eq(messages.status, "envoye"),
      ),
    )
    .where(
      and(
        eq(prospects.status, "EN_ATTENTE"),
        isNull(prospects.lastInboundAt),
        lte(messages.sentAt, cutoff),
        notExists(
          db
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.prospectId, prospects.id),
                eq(messages.direction, "sortant"),
                eq(messages.sequenceStep, 1),
              ),
            ),
        ),
      ),
    )
    .limit(PLAN_BATCH);

  let planned = 0;
  for (const row of candidates) {
    if (!row.initial.toAddress || (await isExcluded(db, row.initial.toAddress))) continue;

    // Réponse automatique reçue ? → la relance est décalée d'un délai complet.
    const [lastAuto] = await db
      .select({ at: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.prospectId, row.prospect.id),
          eq(messages.direction, "entrant"),
          eq(messages.isAutoReply, true),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (lastAuto && lastAuto.at.getTime() > cutoff.getTime()) continue;

    const p = row.prospect;
    const conversation: MessageSummary[] = [
      {
        direction: "sortant",
        date: row.initial.sentAt?.toISOString().slice(0, 10) ?? "",
        subject: row.initial.subject ?? undefined,
        excerpt: row.initial.bodyText.slice(0, 400),
      },
    ];
    const id = await generateAndInsert(db, deps, {
      prospectId: p.id,
      toAddress: row.initial.toAddress,
      step: 1,
      inReplyTo: row.initial.smtpMessageId ?? undefined,
      settings,
      now,
      personalizeInput: {
        prospect: {
          companyName: p.companyName,
          niche: p.niche ?? undefined,
          city: p.locationCity ?? undefined,
          description: p.description ?? undefined,
        },
        channel: "email",
        kind: "relance",
        senderActivity: settings.senderActivity,
        conversation,
      },
    });
    if (id) planned++;
  }
  return planned;
}

export interface SendReport {
  sent: number;
  failed: number;
  rescheduled: number;
  stopped?: boolean;
}

/** Envoie les messages planifiés arrivés à échéance (verrou atomique, quotas, STOP). */
export async function sendDueEmails(db: Db, deps: SequencerDeps): Promise<SendReport> {
  const report: SendReport = { sent: 0, failed: 0, rescheduled: 0 };
  const settings = await getSettings(db);
  const now = (deps.now ?? (() => new Date()))();
  const random = deps.random ?? Math.random;

  if (settings.automationPaused) {
    report.stopped = true;
    return report;
  }
  if (!isWithinSendWindow(settings.sendWindow, settings.timezone, now)) return report;

  const due = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.direction, "sortant"),
        eq(messages.channel, "email"),
        eq(messages.status, "planifie"),
        lte(messages.scheduledAt, now),
      ),
    )
    .orderBy(asc(messages.scheduledAt))
    .limit(SEND_BATCH);

  const today = localDateString(settings.timezone, now);
  const quota = effectiveEmailQuota(
    settings.emailDailyMax,
    settings.warmupEnabled,
    settings.warmupStartDate,
    today,
  );

  for (const msg of due) {
    // Re-vérifications au moment T (§7.4)
    const [prospect] = await db.select().from(prospects).where(eq(prospects.id, msg.prospectId));
    if (!prospect) continue;
    if (["PAS_INTERESSE", "EXCLU", "EMAIL_INVALIDE"].includes(prospect.status)) {
      await db.update(messages).set({ status: "brouillon" }).where(eq(messages.id, msg.id));
      continue;
    }
    if (!msg.toAddress || (await isExcluded(db, msg.toAddress))) {
      await db
        .update(messages)
        .set({ status: "echec", errorMessage: "Destinataire dans la liste d'exclusion" })
        .where(eq(messages.id, msg.id));
      continue;
    }

    const allowed = await canSendAndConsume(db, {
      key: "email",
      max: Number.isFinite(quota) ? quota : settings.emailDailyMax,
      tz: settings.timezone,
      now,
    });
    if (!allowed) {
      // Quota du jour atteint → reporter au prochain créneau du lendemain
      const nextDay = nextWindowStart(
        settings.sendWindow,
        settings.timezone,
        nextLocalMidnight(settings.timezone, now),
      );
      await db
        .update(messages)
        .set({ scheduledAt: new Date(nextDay.getTime() + jitterMs(settings, random)) })
        .where(eq(messages.id, msg.id));
      report.rescheduled++;
      continue;
    }

    // Verrou atomique anti-double-envoi : ne continuer que si NOUS avons
    // fait passer le message de `planifie` à `envoi_en_cours`.
    const locked = await db
      .update(messages)
      .set({ status: "envoi_en_cours" })
      .where(and(eq(messages.id, msg.id), eq(messages.status, "planifie")))
      .returning({ id: messages.id });
    if (locked.length === 0) {
      await releaseQuota(db, "email", settings.timezone, now);
      continue;
    }

    // STOP re-vérifié immédiatement avant l'envoi (§2.7)
    if (await isAutomationPaused(db)) {
      await db.update(messages).set({ status: "planifie" }).where(eq(messages.id, msg.id));
      await releaseQuota(db, "email", settings.timezone, now);
      report.stopped = true;
      break;
    }

    const result = await deps.sendEmail({
      to: msg.toAddress,
      subject: msg.subject ?? undefined,
      body: msg.bodyText,
      inReplyTo: msg.inReplyTo ?? undefined,
    });

    if (result.ok) {
      await db
        .update(messages)
        .set({ status: "envoye", sentAt: now, smtpMessageId: result.smtpMessageId ?? null })
        .where(eq(messages.id, msg.id));
      const patch: Partial<typeof prospects.$inferInsert> = { updatedAt: new Date() };
      if (!prospect.firstContactedAt) patch.firstContactedAt = now;
      await db.update(prospects).set(patch).where(eq(prospects.id, msg.prospectId));
      if (prospect.status === "NOUVEAU" || prospect.status === "A_RELANCER") {
        await changeProspectStatus(db, msg.prospectId, "EN_ATTENTE", "systeme");
      }
      if (settings.warmupEnabled && !settings.warmupStartDate) {
        await updateSettings(db, { warmupStartDate: today });
      }
      await emitEvent(db, "email.sent", { prospectId: msg.prospectId, step: msg.sequenceStep });
      if (msg.sequenceStep === 0) {
        await emitEvent(db, "prospect.contacted", { prospectId: msg.prospectId });
      }
      report.sent++;
    } else {
      await db
        .update(messages)
        .set({ status: "echec", errorMessage: result.error ?? "Erreur d'envoi inconnue" })
        .where(eq(messages.id, msg.id));
      await releaseQuota(db, "email", settings.timezone, now);
      await logEvent(db, "email-sequencer", `Échec d'envoi : ${result.error}`, {
        messageId: msg.id,
      }, "error");
      report.failed++;
    }
  }
  return report;
}

/** Mode revue : valider (avec éventuelles modifications) → planifier. */
export async function approveMessage(
  db: Db,
  messageId: string,
  edits: { subject?: string; body?: string } = {},
  deps: Pick<SequencerDeps, "now" | "random"> = {},
): Promise<void> {
  const settings = await getSettings(db);
  const now = (deps.now ?? (() => new Date()))();
  const random = deps.random ?? Math.random;
  const scheduledAt = await computeNextSlot(db, settings, now, random);
  await db
    .update(messages)
    .set({
      subject: edits.subject !== undefined ? edits.subject : undefined,
      bodyText: edits.body !== undefined ? edits.body : undefined,
      status: "planifie",
      scheduledAt,
    })
    .where(and(eq(messages.id, messageId), eq(messages.status, "en_attente_revue")));
}

/** Mode revue : rejeter → retour brouillon (le prospect redevient planifiable). */
export async function rejectMessage(db: Db, messageId: string): Promise<void> {
  await db
    .update(messages)
    .set({ status: "brouillon" })
    .where(and(eq(messages.id, messageId), eq(messages.status, "en_attente_revue")));
}
