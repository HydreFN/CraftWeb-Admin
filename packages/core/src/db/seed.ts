import { loadConfig } from "../config.js";
import { closeDb, getDb } from "./client.js";
import {
  contactChannels,
  manualDmQueue,
  messages,
  prospects,
  socialProfiles,
  statusHistory,
} from "./schema.js";

/**
 * Seed de démonstration : quelques fiches réalistes pour découvrir
 * l'interface sans lancer de découverte. Idempotent (skip si déjà seedé).
 */
async function main() {
  const env = loadConfig();
  const db = getDb(env.DATABASE_URL);

  const existing = await db.select({ id: prospects.id }).from(prospects).limit(1);
  if (existing.length > 0) {
    console.log("Des prospects existent déjà — seed ignoré.");
    await closeDb();
    return;
  }

  const [garage] = await db
    .insert(prospects)
    .values({
      companyName: "Garage Martin Automobiles",
      niche: "garage",
      locationCity: "Lyon",
      locationCountry: "FR",
      websiteUrl: "https://www.garage-martin-demo.fr",
      websiteDomain: "garage-martin-demo.fr",
      phone: "+33472000001",
      description:
        "Garage indépendant, entretien toutes marques, spécialiste véhicules anciens. Présente régulièrement ses restaurations.",
      discoverySource: "places",
      status: "EN_ATTENTE",
      firstContactedAt: new Date(Date.now() - 3 * 86400000),
    })
    .returning();

  const [resto] = await db
    .insert(prospects)
    .values({
      companyName: "Le Bistrot des Halles",
      niche: "restaurant",
      locationCity: "Lyon",
      locationCountry: "FR",
      phone: "+33472000002",
      description: "Cuisine lyonnaise traditionnelle, produits du marché.",
      discoverySource: "cse_instagram",
      status: "NOUVEAU",
    })
    .returning();

  const [detailing] = await db
    .insert(prospects)
    .values({
      companyName: "ShinyCar Detailing",
      niche: "detailing",
      locationCity: "Villeurbanne",
      locationCountry: "FR",
      websiteUrl: "https://www.shinycar-demo.fr",
      websiteDomain: "shinycar-demo.fr",
      description: "Detailing automobile premium : polissage, céramique, intérieurs.",
      discoverySource: "youtube",
      status: "INTERESSE",
      firstContactedAt: new Date(Date.now() - 6 * 86400000),
      lastInboundAt: new Date(Date.now() - 86400000),
      aiConfidence: 93,
    })
    .returning();

  if (!garage || !resto || !detailing) throw new Error("Seed : insertion prospects échouée");

  await db.insert(contactChannels).values([
    {
      prospectId: garage.id,
      type: "email_generique",
      value: "contact@garage-martin-demo.fr",
      priority: 0,
      mxValid: true,
      isPrimary: true,
      sourceUrl: "https://www.garage-martin-demo.fr/contact",
    },
    {
      prospectId: detailing.id,
      type: "email_generique",
      value: "hello@shinycar-demo.fr",
      priority: 0,
      mxValid: true,
      isPrimary: true,
      sourceUrl: "https://www.shinycar-demo.fr/mentions-legales",
    },
  ]);

  await db.insert(socialProfiles).values([
    {
      prospectId: resto.id,
      platform: "instagram",
      username: "bistrotdeshalles",
      profileUrl: "https://www.instagram.com/bistrotdeshalles/",
      bioSnippet: "Bouchon lyonnais — produits frais du marché",
      source: "cse",
    },
    {
      prospectId: detailing.id,
      platform: "youtube",
      username: "ShinyCarDetailing",
      profileUrl: "https://www.youtube.com/@shinycardetailing",
      followersCount: 12400,
      bioSnippet: "Tutos detailing et transformations avant/après",
      source: "youtube_api",
    },
  ]);

  await db.insert(messages).values([
    {
      prospectId: garage.id,
      direction: "sortant",
      channel: "email",
      subject: "Vos restaurations en vidéo courte",
      bodyText:
        "Bonjour,\n\nJ'ai découvert votre garage et vu que vous présentez régulièrement vos restaurations de véhicules anciens. Je crée des formats courts TikTok/Reels pour des entreprises locales et j'aurais une idée adaptée à votre activité.\n\nSeriez-vous ouvert à un rapide échange ?\n\n—\nDémo Prospection\nCréation de contenus vidéo courts\nVous recevez ce message sur la base de vos coordonnées professionnelles publiques. Pour ne plus recevoir de messages, répondez STOP.",
      sequenceStep: 0,
      aiGenerated: true,
      aiModel: "claude-haiku-4-5",
      status: "envoye",
      toAddress: "contact@garage-martin-demo.fr",
      sentAt: new Date(Date.now() - 3 * 86400000),
      smtpMessageId: "<seed-1@demo.local>",
    },
    {
      prospectId: detailing.id,
      direction: "sortant",
      channel: "email",
      subject: "Idée de format court pour ShinyCar",
      bodyText:
        "Bonjour,\n\nVos avant/après sont impressionnants — je crée des formats courts TikTok/Reels et j'aurais une idée adaptée au detailing.\n\nSeriez-vous ouvert à un rapide échange ?\n\n—\nDémo Prospection\nVous recevez ce message sur la base de vos coordonnées professionnelles publiques. Pour ne plus recevoir de messages, répondez STOP.",
      sequenceStep: 0,
      aiGenerated: true,
      aiModel: "claude-haiku-4-5",
      status: "envoye",
      toAddress: "hello@shinycar-demo.fr",
      sentAt: new Date(Date.now() - 6 * 86400000),
      smtpMessageId: "<seed-2@demo.local>",
    },
    {
      prospectId: detailing.id,
      direction: "entrant",
      channel: "email",
      subject: "RE: Idée de format court pour ShinyCar",
      bodyText:
        "Bonjour, oui ça m'intéresse, on fait déjà un peu de contenu mais on manque de temps. Vous proposez quoi concrètement ?",
      status: "recu",
      fromAddress: "hello@shinycar-demo.fr",
      createdAt: new Date(Date.now() - 86400000),
    },
  ]);

  await db.insert(statusHistory).values([
    { prospectId: garage.id, oldStatus: "NOUVEAU", newStatus: "EN_ATTENTE", changedBy: "systeme" },
    { prospectId: detailing.id, oldStatus: "NOUVEAU", newStatus: "EN_ATTENTE", changedBy: "systeme" },
    { prospectId: detailing.id, oldStatus: "EN_ATTENTE", newStatus: "INTERESSE", changedBy: "ia" },
  ]);

  await db.insert(manualDmQueue).values({
    prospectId: resto.id,
    platform: "instagram",
    messageText:
      "Bonjour ! Vos plats du marché donnent très envie 😋 Je crée des Reels courts pour des restaurants lyonnais — j'aurais une idée simple pour mettre en avant votre carte du jour. Partant pour en discuter ?",
    status: "a_envoyer",
  });

  console.log("Seed de démonstration inséré ✔ (3 prospects, messages, file manuelle)");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
