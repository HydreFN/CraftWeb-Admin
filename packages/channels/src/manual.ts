import type { PersonalizeInput, PersonalizeOutput } from "@prospection/ai";
import {
  contactChannels,
  emitEvent,
  logEvent,
  manualDmQueue,
  prospects,
  socialProfiles,
  type Db,
  type OutboundMessage,
  type Platform,
} from "@prospection/core";
import { and, eq, inArray } from "drizzle-orm";
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

/** Ordre de préférence des plateformes pour le DM (audience + accessibilité). */
const PLATFORM_ORDER: Platform[] = ["instagram", "tiktok", "facebook", "youtube"];

/**
 * §7.6/7.7 — Aucun email exploitable : génère un message adapté au réseau
 * social du prospect et le place dans la file « À envoyer manuellement ».
 * AUCUN envoi automatique. Idempotent : ne crée rien si une entrée
 * `a_envoyer` existe déjà ou si le prospect a déjà été contacté.
 */
export async function generateDmForProspect(
  db: Db,
  deps: { personalize: (input: PersonalizeInput) => Promise<PersonalizeOutput>; senderActivity: string },
  prospectId: string,
): Promise<{ queued: boolean; platform?: Platform; reason?: string }> {
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!prospect) return { queued: false, reason: "prospect inexistant" };
  if (prospect.firstContactedAt) return { queued: false, reason: "déjà contacté" };
  if (["PAS_INTERESSE", "EXCLU"].includes(prospect.status)) {
    return { queued: false, reason: `statut ${prospect.status}` };
  }

  // Un email exploitable existe ? → c'est le canal email qui prime, pas de DM.
  const primary = await db
    .select({ id: contactChannels.id })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.prospectId, prospectId),
        eq(contactChannels.isPrimary, true),
        eq(contactChannels.mxValid, true),
      ),
    )
    .limit(1);
  if (primary.length > 0) return { queued: false, reason: "email exploitable présent" };

  const pending = await db
    .select({ id: manualDmQueue.id })
    .from(manualDmQueue)
    .where(and(eq(manualDmQueue.prospectId, prospectId), inArray(manualDmQueue.status, ["a_envoyer", "envoye"])))
    .limit(1);
  if (pending.length > 0) return { queued: false, reason: "déjà en file" };

  const socials = await db
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.prospectId, prospectId));
  const best = PLATFORM_ORDER.map((pl) => socials.find((s) => s.platform === pl)).find(Boolean);
  if (!best) return { queued: false, reason: "aucun profil social" };

  const generated = await deps.personalize({
    prospect: {
      companyName: prospect.companyName,
      niche: prospect.niche ?? undefined,
      city: prospect.locationCity ?? undefined,
      description: prospect.description ?? best.bioSnippet ?? undefined,
      socialPlatform: best.platform,
      followersCount: best.followersCount ?? undefined,
    },
    channel: best.platform,
    kind: "initial",
    senderActivity: deps.senderActivity,
  });

  const channel = new SocialChannel(best.platform, db);
  await channel.queueManual({
    prospectId,
    channel: best.platform,
    body: generated.body,
  });
  await logEvent(db, "file-manuelle", `Message ${best.platform} généré pour ${prospect.companyName}`, {
    prospectId,
  });
  return { queued: true, platform: best.platform };
}
