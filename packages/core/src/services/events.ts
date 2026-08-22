import type { Db } from "../db/client.js";
import { events } from "../db/schema.js";

/**
 * Pattern outbox (V2-ready) : chaque changement métier notable insère un
 * événement. En V1 la table est alimentée et affichée dans les logs ;
 * les modules V2 la consommeront sans modifier le cœur.
 */
export type EventType =
  | "prospect.discovered"
  | "prospect.enriched"
  | "prospect.contacted"
  | "prospect.replied"
  | "prospect.interested"
  | "prospect.price_request"
  | "prospect.not_interested"
  | "prospect.excluded"
  | "prospect.status_changed"
  | "email.sent"
  | "email.bounced"
  | "dm.queued"
  | "dm.sent_manually";

export async function emitEvent(
  db: Db,
  type: EventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(events).values({ type, payload });
}
