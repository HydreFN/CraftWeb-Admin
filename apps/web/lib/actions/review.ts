"use server";

import { approveMessage, rejectMessage } from "@prospection/channels";
import { changeProspectStatus, contactChannels, logEvent, schema } from "@prospection/core";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

/** Mode revue : valider un email (éventuellement modifié) → planification. */
export async function approveEmailAction(messageId: string, formData: FormData): Promise<void> {
  await requireSession();
  const subject = (formData.get("subject") as string | null) ?? undefined;
  const body = (formData.get("body") as string | null) ?? undefined;
  await approveMessage(db(), messageId, { subject, body });
  await logEvent(db(), "revue", "Email validé pour envoi", { messageId });
  revalidatePath("/a-verifier");
}

export async function rejectEmailAction(messageId: string): Promise<void> {
  await requireSession();
  await rejectMessage(db(), messageId);
  await logEvent(db(), "revue", "Email rejeté (retour brouillon)", { messageId });
  revalidatePath("/a-verifier");
}

/** Choix d'email ambigu : l'utilisateur désigne l'email principal. */
export async function choosePrimaryEmailAction(
  prospectId: string,
  contactId: string,
): Promise<void> {
  await requireSession();
  const database = db();
  await database
    .update(contactChannels)
    .set({ isPrimary: false })
    .where(eq(contactChannels.prospectId, prospectId));
  await database
    .update(contactChannels)
    .set({ isPrimary: true })
    .where(and(eq(contactChannels.id, contactId), eq(contactChannels.prospectId, prospectId)));
  // Le prospect redevient planifiable par le séquenceur
  const [p] = await database
    .select({ status: schema.prospects.status })
    .from(schema.prospects)
    .where(eq(schema.prospects.id, prospectId));
  if (p?.status === "A_VERIFIER") {
    await changeProspectStatus(database, prospectId, "NOUVEAU", "humain");
  }
  await logEvent(database, "revue", "Email principal choisi manuellement", { prospectId });
  revalidatePath("/a-verifier");
}
