import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { prospects, statusHistory, type ProspectStatus } from "../db/schema.js";
import { emitEvent, type EventType } from "./events.js";

const STATUS_EVENTS: Partial<Record<ProspectStatus, EventType>> = {
  INTERESSE: "prospect.interested",
  DEMANDE_DE_PRIX: "prospect.price_request",
  PAS_INTERESSE: "prospect.not_interested",
  EXCLU: "prospect.excluded",
};

/**
 * Change le statut d'un prospect en journalisant l'historique
 * (status_history) et en émettant les événements outbox associés.
 */
export async function changeProspectStatus(
  db: Db,
  prospectId: string,
  newStatus: ProspectStatus,
  changedBy: "systeme" | "ia" | "humain",
): Promise<void> {
  const rows = await db
    .select({ status: prospects.status })
    .from(prospects)
    .where(eq(prospects.id, prospectId));
  const current = rows[0];
  if (!current || current.status === newStatus) return;

  await db
    .update(prospects)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(prospects.id, prospectId));
  await db.insert(statusHistory).values({
    prospectId,
    oldStatus: current.status,
    newStatus,
    changedBy,
  });
  await emitEvent(db, "prospect.status_changed", {
    prospectId,
    oldStatus: current.status,
    newStatus,
    changedBy,
  });
  const specific = STATUS_EVENTS[newStatus];
  if (specific) await emitEvent(db, specific, { prospectId });
}
