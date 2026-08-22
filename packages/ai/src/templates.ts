import type { PersonalizeInput, PersonalizeOutput } from "./types.js";

/**
 * Templates neutres de secours (§7.6) : utilisés quand les données de la
 * fiche sont insuffisantes pour personnaliser honnêtement, ou quand le
 * fournisseur IA est indisponible. Aucune invention — uniquement des
 * formulations génériques de qualité.
 */
export function neutralTemplate(input: PersonalizeInput): PersonalizeOutput {
  const { prospect, channel, kind, senderActivity } = input;
  const secteur = prospect.niche ? ` ${prospect.niche}` : "";
  const ville = prospect.city ? ` à ${prospect.city}` : "";

  if (channel === "email") {
    if (kind === "relance") {
      return {
        body:
          `Bonjour,\n\nJe me permets de revenir vers vous suite à mon précédent message. ` +
          `Si le sujet peut vous intéresser, je reste disponible pour un rapide échange — ` +
          `sinon, aucun souci, je ne vous relancerai pas davantage.\n\nBonne journée,`,
        usedFallback: true,
      };
    }
    return {
      subject: `Votre présence en ligne${secteur ? ` — ${prospect.companyName}` : ""}`,
      body:
        `Bonjour,\n\nJ'ai découvert votre entreprise${secteur ? ` de${secteur}` : ""}${ville} ` +
        `lors d'une recherche sur les commerces locaux. ${senderActivity} — ` +
        `et je pense qu'il y a des choses simples et concrètes à faire pour ${prospect.companyName}.\n\n` +
        `Seriez-vous ouvert à un rapide échange à ce sujet ?\n\nBonne journée,`,
      usedFallback: true,
    };
  }

  // Messages sociaux : plus courts, codes de la plateforme
  const court =
    `Bonjour ! J'ai découvert ${prospect.companyName}${ville} et j'aime beaucoup ce que vous faites. ` +
    `${senderActivity} — j'aurais une idée simple pour vous. Partant pour en discuter ?`;
  return { body: court, usedFallback: true };
}

/** Données minimales pour une personnalisation honnête. */
export function hasEnoughContext(input: PersonalizeInput): boolean {
  const p = input.prospect;
  return Boolean(p.description && p.description.trim().length >= 40);
}
