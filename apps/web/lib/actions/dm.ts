"use server";

import {
  changeProspectStatus,
  emitEvent,
  logEvent,
  manualDmQueue,
  messages,
  prospects,
  schema,
} from "@prospection/core";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

/**
 * « Marquer envoyé » : l'utilisateur a copié le message et l'a envoyé
 * LUI-MÊME depuis son propre compte. On crée le message sortant dans la
 * conversation, on met à jour first_contacted_at et le statut.
 */
export async function markDmSentAction(dmId: string): Promise<void> {
  await requireSession();
  const database = db();
  const [dm] = await database.select().from(manualDmQueue).where(eq(manualDmQueue.id, dmId));
  if (!dm || dm.status !== "a_envoyer") return;

  await database
    .update(manualDmQueue)
    .set({ status: "envoye", handledAt: new Date() })
    .where(eq(manualDmQueue.id, dmId));

  await database.insert(messages).values({
    prospectId: dm.prospectId,
    direction: "sortant",
    channel: dm.platform,
    bodyText: dm.messageText,
    status: "envoye",
    aiGenerated: true,
    sentAt: new Date(),
    sequenceStep: 0,
  });

  const [p] = await database
    .select()
    .from(prospects)
    .where(eq(prospects.id, dm.prospectId));
  if (p) {
    if (!p.firstContactedAt) {
      await database
        .update(prospects)
        .set({ firstContactedAt: new Date(), updatedAt: new Date() })
        .where(eq(prospects.id, dm.prospectId));
    }
    if (p.status === "NOUVEAU") {
      await changeProspectStatus(database, dm.prospectId, "EN_ATTENTE", "humain");
    }
  }
  await emitEvent(database, "dm.sent_manually", { prospectId: dm.prospectId, platform: dm.platform });
  await logEvent(database, "file-manuelle", `DM ${dm.platform} marqué envoyé`, {
    prospectId: dm.prospectId,
  });
  revalidatePath("/file-manuelle");
  revalidatePath(`/prospects/${dm.prospectId}`);
}

export async function ignoreDmAction(dmId: string): Promise<void> {
  await requireSession();
  await db()
    .update(schema.manualDmQueue)
    .set({ status: "ignore", handledAt: new Date() })
    .where(eq(schema.manualDmQueue.id, dmId));
  revalidatePath("/file-manuelle");
}
