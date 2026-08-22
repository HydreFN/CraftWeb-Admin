"use server";

import {
  addExclusion,
  changeProspectStatus,
  emailDomain,
  logEvent,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  schema,
  type ProspectStatus,
} from "@prospection/core";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

const createSchema = z.object({
  companyName: z.string().min(1, "Nom requis").max(200),
  niche: z.string().max(100).optional(),
  locationCity: z.string().max(100).optional(),
  locationCountry: z.string().max(10).optional(),
  websiteUrl: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  description: z.string().max(2000).optional(),
  email: z.string().max(200).optional(),
});

export async function createProspect(formData: FormData): Promise<void> {
  await requireSession();
  const raw = Object.fromEntries(
    ["companyName", "niche", "locationCity", "locationCountry", "websiteUrl", "phone", "description", "email"].map(
      (k) => [k, (formData.get(k) as string | null)?.trim() || undefined],
    ),
  );
  const data = createSchema.parse(raw);
  const database = db();
  const [p] = await database
    .insert(schema.prospects)
    .values({
      companyName: data.companyName,
      niche: data.niche,
      locationCity: data.locationCity,
      locationCountry: data.locationCountry ?? "FR",
      websiteUrl: data.websiteUrl,
      websiteDomain: normalizeDomain(data.websiteUrl),
      phone: normalizePhone(data.phone),
      description: data.description,
      discoverySource: "manuel",
    })
    .returning();
  if (p && data.email) {
    const email = normalizeEmail(data.email);
    if (email) {
      await database.insert(schema.contactChannels).values({
        prospectId: p.id,
        type: "email_generique",
        value: email,
        isPrimary: true,
      });
    }
  }
  await logEvent(database, "crm", `Prospect créé manuellement : ${data.companyName}`);
  revalidatePath("/prospects");
  redirect(p ? `/prospects/${p.id}` : "/prospects");
}

export async function updateNotes(prospectId: string, formData: FormData): Promise<void> {
  await requireSession();
  const notes = ((formData.get("notes") as string | null) ?? "").slice(0, 10000);
  await db()
    .update(schema.prospects)
    .set({ notes, updatedAt: new Date() })
    .where(eq(schema.prospects.id, prospectId));
  revalidatePath(`/prospects/${prospectId}`);
}

export async function setStatus(prospectId: string, formData: FormData): Promise<void> {
  await requireSession();
  const status = formData.get("status") as ProspectStatus;
  const valid = schema.prospectStatusEnum.enumValues;
  if (!valid.includes(status)) throw new Error("Statut invalide");
  await changeProspectStatus(db(), prospectId, status, "humain");
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/prospects");
}

/**
 * Exclusion manuelle : statut EXCLU + inscription de l'email principal
 * (et du domaine si demandé) dans la liste d'exclusion permanente.
 */
export async function excludeProspect(prospectId: string, formData: FormData): Promise<void> {
  await requireSession();
  const database = db();
  const alsoDomain = formData.get("alsoDomain") === "on";
  const contacts = await database
    .select()
    .from(schema.contactChannels)
    .where(eq(schema.contactChannels.prospectId, prospectId));
  for (const c of contacts) {
    const email = normalizeEmail(c.value);
    if (!email) continue;
    await addExclusion(database, email, "email", "manuel");
    if (alsoDomain) {
      const d = emailDomain(email);
      if (d) await addExclusion(database, d, "domaine", "manuel");
    }
  }
  await changeProspectStatus(database, prospectId, "EXCLU", "humain");
  await logEvent(database, "crm", "Prospect exclu manuellement", { prospectId });
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/prospects");
}

export async function addContactChannel(prospectId: string, formData: FormData): Promise<void> {
  await requireSession();
  const email = normalizeEmail(formData.get("email") as string | null);
  if (!email) throw new Error("Email invalide");
  const type = (formData.get("type") as string | null) ?? "email_generique";
  const validTypes = schema.contactTypeEnum.enumValues;
  const database = db();
  await database
    .insert(schema.contactChannels)
    .values({
      prospectId,
      type: validTypes.includes(type as (typeof validTypes)[number])
        ? (type as (typeof validTypes)[number])
        : "email_generique",
      value: email,
      isPrimary: false,
    })
    .onConflictDoNothing();
  revalidatePath(`/prospects/${prospectId}`);
}

export async function setPrimaryContact(prospectId: string, contactId: string): Promise<void> {
  await requireSession();
  const database = db();
  await database
    .update(schema.contactChannels)
    .set({ isPrimary: false })
    .where(eq(schema.contactChannels.prospectId, prospectId));
  await database
    .update(schema.contactChannels)
    .set({ isPrimary: true })
    .where(eq(schema.contactChannels.id, contactId));
  revalidatePath(`/prospects/${prospectId}`);
}

export async function deleteProspect(prospectId: string): Promise<void> {
  await requireSession();
  await db().delete(schema.prospects).where(eq(schema.prospects.id, prospectId));
  await logEvent(db(), "crm", "Prospect supprimé", { prospectId });
  revalidatePath("/prospects");
  redirect("/prospects");
}
