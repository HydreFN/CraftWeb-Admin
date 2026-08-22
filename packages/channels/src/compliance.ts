/**
 * Conformité prospection B2B (§2.5 — doctrine CNIL / art. L.34-5 CPCE).
 * Chaque email sortant DOIT contenir :
 *  - une signature identifiant clairement l'expéditeur (nom + activité)
 *  - la mention d'information (origine de la donnée + droits RGPD)
 *  - un moyen simple de s'opposer : « répondez STOP »
 * L'en-tête List-Unsubscribe est ajouté par l'EmailChannel.
 */

export interface ComplianceOptions {
  senderName: string;
  senderActivity: string;
  /** URL one-click optionnelle (déploiement VPS futur — UNSUBSCRIBE_PUBLIC_URL). */
  unsubscribePublicUrl?: string;
}

export const STOP_INSTRUCTION = "Pour ne plus recevoir de messages, répondez STOP.";

export const INFO_MENTION =
  "Vous recevez ce message professionnel sur la base de vos coordonnées professionnelles " +
  "publiques (site web ou annuaire public). Conformément au RGPD, vous disposez de droits " +
  "d'accès, de rectification et d'opposition : il suffit de répondre à cet email.";

/** Ajoute le pied de conformité au corps d'un email. */
export function withComplianceFooter(body: string, opts: ComplianceOptions): string {
  const lines = [
    body.trimEnd(),
    "",
    "--",
    `${opts.senderName} — ${opts.senderActivity}`,
    "",
    INFO_MENTION,
    STOP_INSTRUCTION,
  ];
  if (opts.unsubscribePublicUrl) {
    lines.push(`Désinscription en un clic : ${opts.unsubscribePublicUrl}`);
  }
  return lines.join("\n");
}

/** Vérifie qu'un corps d'email contient bien toutes les mentions obligatoires. */
export function hasComplianceFooter(body: string): boolean {
  return (
    body.includes("STOP") &&
    body.includes("coordonnées professionnelles") &&
    body.includes("RGPD")
  );
}
