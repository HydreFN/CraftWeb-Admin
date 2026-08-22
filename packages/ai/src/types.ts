import type { MessageSummary, ProspectContext, Tag } from "@prospection/core";

/**
 * Contrat d'interface du fournisseur IA (§5 de la spécification).
 * Implémentation V1 : AnthropicProvider (claude-haiku-4-5 par défaut).
 * OpenAI / Gemini / Ollama : stubs documentés, ajoutables sans toucher
 * au reste du code.
 */
export interface PersonalizeInput {
  /** Uniquement des données vérifiées de la fiche — interdiction d'inventer. */
  prospect: ProspectContext;
  channel: "email" | "instagram" | "tiktok" | "facebook" | "youtube";
  kind: "initial" | "relance" | "brouillon_reponse";
  /** Activité de l'expéditeur (paramètres), pour contextualiser le message. */
  senderActivity: string;
  /** Pour une relance ou un brouillon : messages précédents. */
  conversation?: MessageSummary[];
}

export interface PersonalizeOutput {
  subject?: string;
  body: string;
  /** true si le template neutre de secours a été utilisé (données insuffisantes). */
  usedFallback?: boolean;
}

export interface ClassifyInput {
  conversation: MessageSummary[];
  lastInbound: string;
}

export interface ClassifyOutput {
  classification: Tag;
  confidence: number; // 0-100
  raw?: unknown;
}

export interface AIProvider {
  id: "anthropic" | "openai" | "gemini" | "ollama";
  model: string;
  personalize(input: PersonalizeInput): Promise<PersonalizeOutput>;
  classify(input: ClassifyInput): Promise<ClassifyOutput>;
}
