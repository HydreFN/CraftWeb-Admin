import {
  addExclusion,
  changeProspectStatus,
  classifications,
  contactChannels,
  emitEvent,
  logEvent,
  messages,
  normalizeEmail,
  prospects,
  type Db,
  type MessageSummary,
  type Tag,
} from "@prospection/core";
import { and, asc, eq, or } from "drizzle-orm";
import type { ParsedMail } from "mailparser";

/**
 * Réception et classification (§7.5).
 * Ordre de traitement : bounce → réponse automatique → règles STOP
 * prioritaires (sans IA) → classification IA {classification, confidence}.
 * La classification ne déclenche JAMAIS de réponse automatique à un humain
 * (§2.6) : au mieux un brouillon suggéré, affiché dans la conversation.
 */

export interface ParsedInbound {
  fromAddress: string | null;
  subject: string | null;
  text: string;
  /** en-têtes en minuscules */
  headers: Map<string, string>;
  inReplyTo?: string | null;
  references?: string[] | null;
  date?: Date;
}

export interface InboundDeps {
  classify: (input: {
    conversation: MessageSummary[];
    lastInbound: string;
  }) => Promise<{ classification: Tag; confidence: number; raw?: unknown }>;
  /** Génère un brouillon de réponse suggéré (jamais envoyé automatiquement). */
  draftReply?: (input: {
    conversation: MessageSummary[];
  }) => Promise<{ body: string } | null>;
  aiModel: string;
  now?: () => Date;
}

/** Convertit un mail parsé (mailparser) vers la forme interne. */
export function parsedMailToInbound(mail: ParsedMail): ParsedInbound {
  const headers = new Map<string, string>();
  for (const [key, value] of mail.headers) {
    headers.set(
      key.toLowerCase(),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  const refs = mail.references
    ? Array.isArray(mail.references)
      ? mail.references
      : [mail.references]
    : null;
  return {
    fromAddress: mail.from?.value?.[0]?.address ?? null,
    subject: mail.subject ?? null,
    text: mail.text ?? "",
    headers,
    inReplyTo: mail.inReplyTo ?? null,
    references: refs,
    date: mail.date ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Détections (fonctions pures, testées sur fixtures)
// ---------------------------------------------------------------------------

const BOUNCE_FROM_RE = /mailer-daemon|postmaster@/i;
const BOUNCE_SUBJECT_RE =
  /undeliver|delivery (status notification|failure|has failed)|mail delivery failed|returned mail|échec de (la )?livraison|non remis|address not found/i;
const HARD_BOUNCE_RE =
  /55[0-9][ -]|user unknown|unknown user|no such user|mailbox (unavailable|not found|does not exist)|address rejected|recipient rejected|does not exist/i;

export function detectBounce(mail: ParsedInbound): { isBounce: boolean; hard: boolean; failedRecipient: string | null } {
  const from = mail.fromAddress ?? "";
  const subject = mail.subject ?? "";
  const contentType = mail.headers.get("content-type") ?? "";
  const isBounce =
    BOUNCE_FROM_RE.test(from) ||
    BOUNCE_SUBJECT_RE.test(subject) ||
    contentType.includes("multipart/report");
  if (!isBounce) return { isBounce: false, hard: false, failedRecipient: null };

  const hard = HARD_BOUNCE_RE.test(mail.text) || /^5\.\d+\.\d+/m.test(mail.text);
  // Final-Recipient / X-Failed-Recipients / première adresse du corps
  const finalRecipient =
    /final-recipient:[^;]*;\s*<?([^\s<>;]+@[^\s<>;]+)>?/i.exec(mail.text)?.[1] ??
    mail.headers.get("x-failed-recipients") ??
    /<?([a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i.exec(mail.text)?.[1] ??
    null;
  return { isBounce: true, hard, failedRecipient: normalizeEmail(finalRecipient) };
}

const AUTOREPLY_SUBJECT_RE =
  /r[ée]ponse automatique|absence|absent|out of office|automatic reply|auto[- ]?reply|autoreply|cong[ée]s?|vacation|je suis en d[ée]placement/i;

export function detectAutoReply(mail: ParsedInbound): boolean {
  const autoSubmitted = (mail.headers.get("auto-submitted") ?? "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (mail.headers.has("x-autoreply") || mail.headers.has("x-autorespond")) return true;
  const precedence = (mail.headers.get("precedence") ?? "").toLowerCase();
  if (precedence === "auto_reply" || precedence === "junk") return true;
  return AUTOREPLY_SUBJECT_RE.test(mail.subject ?? "");
}

const STOP_RE =
  /(^|\W)stop(\W|$)|d[ée]sinscri|ne (plus|pas) (me|nous) (contacter|recontacter|solliciter|écrire|ecrire)|arr[êe]tez de (me|nous) contacter|plus de (mail|message|courriel)|unsubscribe|retirer (mon|notre) (adresse|email)/i;

/** Règles prioritaires AVANT IA (§7.5) : opposition explicite. */
export function detectStopIntent(text: string): boolean {
  return STOP_RE.test(text.slice(0, 2000));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type InboundOutcome =
  | "ignored_unknown_sender"
  | "bounce_hard"
  | "bounce_soft"
  | "auto_reply"
  | "stop_exclusion"
  | "classified"
  | "a_verifier";

export async function processInboundEmail(
  db: Db,
  deps: InboundDeps,
  mail: ParsedInbound,
): Promise<{ outcome: InboundOutcome; prospectId?: string; classification?: Tag; confidence?: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const fromEmail = normalizeEmail(mail.fromAddress);

  // --- Rattachement au fil : In-Reply-To/References → smtp_message_id,
  //     sinon correspondance expéditeur ↔ contact_channels.
  let prospectId: string | null = null;
  const refIds = [mail.inReplyTo, ...(mail.references ?? [])].filter(
    (r): r is string => Boolean(r),
  );
  if (refIds.length > 0) {
    const conditions = refIds.map((r) => eq(messages.smtpMessageId, r));
    const [ref] = await db
      .select({ prospectId: messages.prospectId })
      .from(messages)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(1);
    if (ref) prospectId = ref.prospectId;
  }
  const bounce = detectBounce(mail);
  if (!prospectId && fromEmail && !bounce.isBounce) {
    const [contact] = await db
      .select({ prospectId: contactChannels.prospectId })
      .from(contactChannels)
      .where(eq(contactChannels.value, fromEmail))
      .limit(1);
    if (contact) prospectId = contact.prospectId;
  }
  if (!prospectId && bounce.isBounce && bounce.failedRecipient) {
    const [contact] = await db
      .select({ prospectId: contactChannels.prospectId })
      .from(contactChannels)
      .where(eq(contactChannels.value, bounce.failedRecipient))
      .limit(1);
    if (contact) prospectId = contact.prospectId;
  }
  if (!prospectId) {
    await logEvent(db, "inbox", `Message entrant ignoré (expéditeur inconnu : ${fromEmail ?? "?"})`, {}, "debug");
    return { outcome: "ignored_unknown_sender" };
  }

  const isAutoReply = !bounce.isBounce && detectAutoReply(mail);

  // --- Insertion du message entrant
  const [inserted] = await db
    .insert(messages)
    .values({
      prospectId,
      direction: "entrant",
      channel: "email",
      subject: mail.subject,
      bodyText: mail.text.slice(0, 20000),
      status: "recu",
      fromAddress: fromEmail,
      isBounce: bounce.isBounce,
      isAutoReply,
      inReplyTo: mail.inReplyTo ?? null,
      createdAt: mail.date ?? now,
    })
    .returning({ id: messages.id });
  const messageId = inserted!.id;

  // --- Bounces (§7.5)
  if (bounce.isBounce) {
    if (bounce.hard && bounce.failedRecipient) {
      await db
        .update(contactChannels)
        .set({ mxValid: false })
        .where(
          and(eq(contactChannels.prospectId, prospectId), eq(contactChannels.value, bounce.failedRecipient)),
        );
      await addExclusion(db, bounce.failedRecipient, "email", "bounce_hard");
      await changeProspectStatus(db, prospectId, "EMAIL_INVALIDE", "systeme");
      await emitEvent(db, "email.bounced", { prospectId, recipient: bounce.failedRecipient });

      // Autre candidat ? → proposition de bascule dans « À vérifier »
      const alternatives = await db
        .select()
        .from(contactChannels)
        .where(
          and(eq(contactChannels.prospectId, prospectId), eq(contactChannels.mxValid, true)),
        );
      await logEvent(
        db,
        "inbox",
        alternatives.length > 0
          ? `Hard bounce — ${alternatives.length} email(s) alternatif(s) à valider dans « À vérifier »`
          : "Hard bounce — aucun email alternatif",
        { prospectId, failed: bounce.failedRecipient },
        "warn",
      );
      return { outcome: "bounce_hard", prospectId };
    }
    await logEvent(db, "inbox", "Bounce temporaire (soft) reçu", { prospectId }, "info");
    return { outcome: "bounce_soft", prospectId };
  }

  // --- Réponses automatiques : hors stats, hors classification, relance décalée
  if (isAutoReply) {
    await logEvent(db, "inbox", "Réponse automatique détectée (relance décalée)", { prospectId });
    return { outcome: "auto_reply", prospectId };
  }

  // --- Vraie réponse humaine
  await db
    .update(prospects)
    .set({ lastInboundAt: now, updatedAt: now })
    .where(eq(prospects.id, prospectId));
  await emitEvent(db, "prospect.replied", { prospectId });

  // Règles prioritaires AVANT IA : STOP / désinscription
  if (detectStopIntent(mail.text)) {
    if (fromEmail) await addExclusion(db, fromEmail, "email", "desinscription");
    const outboundAddresses = await db
      .select({ value: contactChannels.value })
      .from(contactChannels)
      .where(eq(contactChannels.prospectId, prospectId));
    for (const c of outboundAddresses) {
      await addExclusion(db, c.value, "email", "desinscription");
    }
    await changeProspectStatus(db, prospectId, "PAS_INTERESSE", "systeme");
    await logEvent(db, "inbox", "STOP/désinscription → exclusion permanente immédiate", {
      prospectId,
    }, "warn");
    return { outcome: "stop_exclusion", prospectId };
  }

  // --- Classification IA
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.prospectId, prospectId))
    .orderBy(asc(messages.createdAt))
    .limit(20);
  const conversation: MessageSummary[] = history.map((m) => ({
    direction: m.direction,
    date: (m.sentAt ?? m.createdAt).toISOString().slice(0, 10),
    subject: m.subject ?? undefined,
    excerpt: m.bodyText.slice(0, 400),
  }));

  const result = await deps.classify({ conversation, lastInbound: mail.text.slice(0, 4000) });
  await db.insert(classifications).values({
    messageId,
    label: result.classification,
    confidence: result.confidence,
    model: deps.aiModel,
    rawJson: result.raw ? { raw: result.raw } : null,
    humanValidated: false,
  });
  await db
    .update(prospects)
    .set({ aiConfidence: result.confidence })
    .where(eq(prospects.id, prospectId));

  if (result.confidence < 80) {
    // Seuil : aucune action automatique, validation humaine requise
    await changeProspectStatus(db, prospectId, "A_VERIFIER", "ia");
    return {
      outcome: "a_verifier",
      prospectId,
      classification: result.classification,
      confidence: result.confidence,
    };
  }

  const statusByTag: Record<Tag, Parameters<typeof changeProspectStatus>[2]> = {
    INTERESSE: "INTERESSE",
    DEMANDE_DE_PRIX: "DEMANDE_DE_PRIX",
    PAS_INTERESSE: "PAS_INTERESSE",
    A_RELANCER: "A_RELANCER",
    QUESTION: "QUESTION",
    EN_ATTENTE: "EN_ATTENTE",
    A_VERIFIER: "A_VERIFIER",
  };
  await changeProspectStatus(db, prospectId, statusByTag[result.classification], "ia");

  // Refus classé avec confiance → arrêt immédiat + exclusion permanente
  if (result.classification === "PAS_INTERESSE") {
    if (fromEmail) await addExclusion(db, fromEmail, "email", "refus_reponse");
  }

  // Intéressé / demande de prix → brouillon de réponse suggéré (jamais envoyé seul)
  if (
    (result.classification === "INTERESSE" || result.classification === "DEMANDE_DE_PRIX") &&
    deps.draftReply
  ) {
    try {
      const draft = await deps.draftReply({ conversation });
      if (draft) {
        await db.insert(messages).values({
          prospectId,
          direction: "sortant",
          channel: "email",
          subject: mail.subject ? `RE: ${mail.subject.replace(/^re:\s*/i, "")}` : null,
          bodyText: draft.body,
          status: "brouillon",
          aiGenerated: true,
          aiModel: deps.aiModel,
          toAddress: fromEmail,
        });
      }
    } catch {
      // le brouillon est un bonus — jamais bloquant
    }
  }

  return {
    outcome: "classified",
    prospectId,
    classification: result.classification,
    confidence: result.confidence,
  };
}
