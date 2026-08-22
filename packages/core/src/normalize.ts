/**
 * Normalisations utilisées par la déduplication et l'exclusion.
 * Fonctions pures, testées unitairement.
 */

/** Normalise un domaine web : minuscules, sans protocole, sans www, sans chemin. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
    const url = new URL(s);
    let host = url.hostname;
    if (host.startsWith("www.")) host = host.slice(4);
    // Ignorer les hôtes qui sont eux-mêmes des plateformes sociales ou des
    // agrégateurs : ils ne constituent pas le site officiel de l'entreprise.
    if (!host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

const SOCIAL_OR_AGGREGATOR_HOSTS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "youtube.com",
  "youtu.be",
  "linktr.ee",
  "linkin.bio",
  "beacons.ai",
  "google.com",
  "goo.gl",
];

/** true si le domaine appartient à une plateforme sociale / un agrégateur. */
export function isSocialOrAggregatorDomain(domain: string | null): boolean {
  if (!domain) return false;
  return SOCIAL_OR_AGGREGATOR_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`));
}

/**
 * Normalise un téléphone en E.164 (best-effort, centré France par défaut).
 * Retourne null si la chaîne ne ressemble pas à un numéro exploitable.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountryPrefix = "+33",
): string | null {
  if (!input) return null;
  let s = input.replace(/[\s().\- ]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{6,15}$/.test(digits)) return null;
    return `+${digits}`;
  }
  if (!/^\d{6,15}$/.test(s)) return null;
  // Numéro national français : 0X XX XX XX XX → +33X…
  if (s.length === 10 && s.startsWith("0")) {
    return `${defaultCountryPrefix}${s.slice(1)}`;
  }
  return `${defaultCountryPrefix}${s}`;
}

/** Normalise un email : trim + minuscules. Retourne null si invalide. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  // Syntaxe volontairement stricte mais raisonnable
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

/** Domaine d'un email normalisé. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Normalise un nom d'entreprise pour la comparaison (similarité trigram). */
export function normalizeCompanyName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sarl|sas|sasu|eurl|sa|sci|auto|entreprise|ets|societe|société)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalise une ville pour comparaison. */
export function normalizeCity(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s || null;
}
