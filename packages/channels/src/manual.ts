import {
  emitEvent,
  manualDmQueue,
  type Db,
  type OutboundMessage,
  type Platform,
} from "@prospection/core";
import type { OutreachChannel } from "./types.js";

/**
 * Canaux sociaux (§7.7) — mode MANUEL uniquement : les messages générés
 * sont placés dans la file « À envoyer manuellement ». AUCUN DM n'est
 * jamais envoyé automatiquement (§2.1) : ces canaux n'implémentent pas
 * `send`.
 */
export class SocialChannel implements OutreachChannel {
  readonly mode = "manual" as const;

  constructor(
    readonly id: Platform,
    private readonly db: Db,
  ) {}

  async queueManual(msg: OutboundMessage): Promise<void> {
    await this.db.insert(manualDmQueue).values({
      prospectId: msg.prospectId,
      platform: this.id,
      messageText: msg.body,
      status: "a_envoyer",
    });
    await emitEvent(this.db, "dm.queued", { prospectId: msg.prospectId, platform: this.id });
  }
}
