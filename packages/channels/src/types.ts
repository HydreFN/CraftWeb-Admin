import type { MessageChannel, OutboundMessage, SendResult } from "@prospection/core";

/**
 * Contrat d'interface des canaux de contact (§5 de la spécification).
 * En V1, seul EmailChannel implémente `send` (mode auto).
 * Les canaux sociaux sont en mode `manual` : `queueManual` alimente
 * la file « À envoyer manuellement » — AUCUN DM n'est jamais envoyé
 * automatiquement.
 */
export interface OutreachChannel {
  id: MessageChannel;
  mode: "auto" | "manual";
  send?(msg: OutboundMessage): Promise<SendResult>;
  queueManual?(msg: OutboundMessage): Promise<void>;
}
