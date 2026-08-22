import type { MessageChannel, Platform, ProspectStatus } from "./db/schema.js";

/** Les 7 tags de classification des réponses. */
export const CLASSIFICATION_TAGS = [
  "INTERESSE",
  "DEMANDE_DE_PRIX",
  "PAS_INTERESSE",
  "A_RELANCER",
  "QUESTION",
  "EN_ATTENTE",
  "A_VERIFIER",
] as const;

export type Tag = (typeof CLASSIFICATION_TAGS)[number];

export const TAG_EMOJI: Record<Tag, string> = {
  INTERESSE: "🟢",
  DEMANDE_DE_PRIX: "💰",
  PAS_INTERESSE: "🔴",
  A_RELANCER: "🟡",
  QUESTION: "🔵",
  EN_ATTENTE: "⚪",
  A_VERIFIER: "🟣",
};

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  NOUVEAU: "Nouveau",
  EN_ATTENTE: "⚪ En attente",
  INTERESSE: "🟢 Intéressé",
  DEMANDE_DE_PRIX: "💰 Demande de prix",
  PAS_INTERESSE: "🔴 Pas intéressé",
  A_RELANCER: "🟡 À relancer",
  QUESTION: "🔵 Question",
  A_VERIFIER: "🟣 À vérifier",
  EMAIL_INVALIDE: "Email invalide",
  EXCLU: "Exclu",
};

/** Critères de recherche pour la découverte. */
export interface SearchCriteria {
  country: string;
  city: string;
  sector: string;
  keywords?: string;
  sources: string[];
}

/** Entreprise découverte par une source, avant déduplication/insertion. */
export interface DiscoveredBusiness {
  companyName: string;
  niche?: string;
  city?: string;
  country?: string;
  websiteUrl?: string;
  phone?: string;
  description?: string;
  socialProfile?: {
    platform: Platform;
    profileUrl: string;
    username?: string;
    followersCount?: number;
    bioSnippet?: string;
  };
}

/** Contexte prospect passé à l'IA — uniquement des données vérifiées de la fiche. */
export interface ProspectContext {
  companyName: string;
  niche?: string;
  city?: string;
  country?: string;
  description?: string;
  websiteUrl?: string;
  socialPlatform?: Platform;
  followersCount?: number;
}

export interface MessageSummary {
  direction: "sortant" | "entrant";
  date: string;
  subject?: string;
  excerpt: string;
}

export interface OutboundMessage {
  prospectId: string;
  channel: MessageChannel;
  subject?: string;
  body: string;
}

export interface SendResult {
  ok: boolean;
  smtpMessageId?: string;
  error?: string;
}

export type { MessageChannel, Platform, ProspectStatus };
