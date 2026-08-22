import Anthropic from "@anthropic-ai/sdk";
import { CLASSIFICATION_TAGS, type Tag } from "@prospection/core";
import { z } from "zod";
import { hasEnoughContext, neutralTemplate } from "./templates.js";
import type {
  AIProvider,
  ClassifyInput,
  ClassifyOutput,
  PersonalizeInput,
  PersonalizeOutput,
} from "./types.js";

/** Sous-ensemble du client Anthropic utilisé — injectable pour les tests. */
export interface MessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: { role: "user" | "assistant"; content: string }[];
    }): Promise<{ content: { type: string; text?: string }[] }>;
  };
}

const PERSONALIZE_SYSTEM = `Tu rédiges des messages de prospection B2B en français pour un indépendant.

RÈGLES ABSOLUES :
- N'utilise QUE les informations vérifiées fournies dans la fiche prospect. INTERDICTION D'INVENTER des faits, chiffres, détails ou observations qui n'y figurent pas.
- Si une information n'est pas fournie, n'y fais pas allusion.
- Objet du message lié à l'activité professionnelle du destinataire.
- Jamais de mots "spam" (gratuit, urgent, promo, incroyable…), jamais de majuscules criardes, pas de point d'exclamation dans l'objet.
- Un seul appel à l'action, ton naturel et sobre.
- Email initial : 60 à 120 mots, objet court et sobre.
- Relance : 2 à 3 phrases, référence au premier message, sans aucune pression.
- Messages sociaux (Instagram/TikTok/Facebook/YouTube) : nettement plus courts (2-3 phrases), ton adapté aux codes de la plateforme, tutoiement uniquement si l'univers de la marque s'y prête.
- Ne signe pas, n'ajoute pas de coordonnées ni de mention légale : elles sont ajoutées automatiquement.

Réponds UNIQUEMENT en JSON strict : {"subject": "...", "body": "..."} pour un email, {"body": "..."} sinon.`;

const CLASSIFY_SYSTEM = `Tu classifies la dernière réponse d'un prospect B2B dans EXACTEMENT une de ces catégories :
- INTERESSE : intérêt explicite, veut en savoir plus ou continuer l'échange
- DEMANDE_DE_PRIX : demande de tarif, devis, budget
- PAS_INTERESSE : refus, pas besoin, déjà équipé
- A_RELANCER : demande de revenir plus tard ("recontactez-moi en mars", "pas le moment")
- QUESTION : pose une question qui appelle une réponse avant toute suite
- EN_ATTENTE : réponse neutre/vague qui n'appelle pas d'action claire
- A_VERIFIER : ambigu, ironique, mélange de signaux, ou impossible à classer

Réponds UNIQUEMENT en JSON strict : {"classification": "<catégorie>", "confidence": <0-100>}.
confidence reflète ta certitude réelle : sois conservateur en cas de doute.`;

const personalizeSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
});

const classifySchema = z.object({
  classification: z.enum(CLASSIFICATION_TAGS),
  confidence: z.number().min(0).max(100),
});

/** Extraction JSON robuste : tolère le texte autour et les fences markdown. */
export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly client: MessagesClient;

  constructor(opts: { apiKey?: string; model?: string; client?: MessagesClient }) {
    this.model = opts.model ?? "claude-haiku-4-5";
    this.client =
      opts.client ??
      (new Anthropic({ apiKey: opts.apiKey }) as unknown as MessagesClient);
  }

  async personalize(input: PersonalizeInput): Promise<PersonalizeOutput> {
    // Règle d'or : données insuffisantes → template neutre, pas d'invention.
    if (!hasEnoughContext(input) && input.kind !== "brouillon_reponse") {
      return neutralTemplate(input);
    }

    const p = input.prospect;
    const fiche = [
      `Entreprise : ${p.companyName}`,
      p.niche && `Secteur : ${p.niche}`,
      p.city && `Ville : ${p.city}`,
      p.description && `Description (issue du site officiel / de la chaîne) : ${p.description}`,
      p.followersCount != null && `Abonnés (${p.socialPlatform ?? "réseau"}) : ${p.followersCount}`,
      p.websiteUrl && `Site : ${p.websiteUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    const conversation = (input.conversation ?? [])
      .map((m) => `[${m.direction} — ${m.date}] ${m.subject ? `${m.subject} — ` : ""}${m.excerpt}`)
      .join("\n");

    const task =
      input.kind === "initial"
        ? `Rédige le message INITIAL (canal : ${input.channel}).`
        : input.kind === "relance"
          ? `Rédige la RELANCE (canal : ${input.channel}). Messages précédents :\n${conversation}`
          : `Rédige un BROUILLON DE RÉPONSE (canal : ${input.channel}) que l'utilisateur validera lui-même. Conversation :\n${conversation}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: PERSONALIZE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Activité de l'expéditeur : ${input.senderActivity}\n\nFiche prospect (données vérifiées uniquement) :\n${fiche}\n\n${task}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = personalizeSchema.safeParse(extractJson(text));
    if (!parsed.success) return neutralTemplate(input);
    return {
      subject: input.channel === "email" ? parsed.data.subject : undefined,
      body: parsed.data.body.trim(),
    };
  }

  async classify(input: ClassifyInput): Promise<ClassifyOutput> {
    const conversation = input.conversation
      .map((m) => `[${m.direction} — ${m.date}] ${m.subject ? `${m.subject} — ` : ""}${m.excerpt}`)
      .join("\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Conversation :\n${conversation}\n\nDernier message ENTRANT à classifier :\n"""\n${input.lastInbound}\n"""`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = classifySchema.safeParse(extractJson(text));
    if (!parsed.success) {
      // Parse impossible → A_VERIFIER avec confiance nulle (validation humaine)
      return { classification: "A_VERIFIER" as Tag, confidence: 0, raw: text };
    }
    return {
      classification: parsed.data.classification,
      confidence: Math.round(parsed.data.confidence),
      raw: text,
    };
  }
}
