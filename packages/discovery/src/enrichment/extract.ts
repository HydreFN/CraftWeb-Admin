import { normalizeEmail, type Platform } from "@prospection/core";
import { parseProfileUrl } from "../sources/cse.js";

/**
 * Extraction d'informations depuis le HTML d'un site officiel :
 * emails (mailto + texte), liens vers réseaux sociaux, description.
 * Uniquement des chaînes — aucun DOM, aucune exécution de script.
 */

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Faux positifs classiques : techniques, hébergeurs, widgets, exemples. */
const EMAIL_BLOCKLIST_LOCAL = [
  "no-reply",
  "noreply",
  "no_reply",
  "donotreply",
  "exemple",
  "example",
  "test",
  "user",
  "email",
  "prenom",
  "nom",
  "votre",
  "your",
  "webmaster",
  "postmaster",
  "abuse",
  "mailer-daemon",
];
const EMAIL_BLOCKLIST_DOMAIN = [
  "example.com",
  "exemple.fr",
  "email.com",
  "domain.com",
  "domaine.fr",
  "sentry.io",
  "wixpress.com",
  "sentry.wixpress.com",
  "godaddy.com",
  "ovh.com",
  "ovh.net",
  "gandi.net",
  "cloudflare.com",
  "googlemail.com.invalid",
  "mysite.com",
  "monsite.fr",
  "wordpress.com",
  "placeholder.com",
];
/** Extensions de fichiers : « logo@2x.png » ressemble à un email. */
const FILE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?)$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s*\[at\]\s*|\s+arobase\s+|\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[dot\]\s*|\s*\(dot\)\s*|\s+point\s+/gi, ".");
}

export function extractEmails(html: string): string[] {
  const decoded = decodeEntities(html);
  const candidates = new Set<string>();

  // mailto: prioritaires (intention claire de publication)
  for (const m of decoded.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const email = normalizeEmail(decodeURIComponent(m[1] ?? ""));
    if (email) candidates.add(email);
  }
  // texte brut
  for (const m of decoded.matchAll(EMAIL_RE)) {
    const email = normalizeEmail(m[0]);
    if (email) candidates.add(email);
  }

  return [...candidates].filter((email) => {
    const [local = "", domain = ""] = email.split("@");
    if (FILE_EXT_RE.test(email)) return false;
    if (EMAIL_BLOCKLIST_LOCAL.some((b) => local === b || local.startsWith(`${b}@`) || local === `${b}`)) {
      return false;
    }
    if (EMAIL_BLOCKLIST_LOCAL.includes(local)) return false;
    if (EMAIL_BLOCKLIST_DOMAIN.some((b) => domain === b || domain.endsWith(`.${b}`))) return false;
    return true;
  });
}

export type EmailKind = "email_generique" | "email_service" | "email_nominatif";

const GENERIC_LOCALS = ["contact", "info", "infos", "hello", "bonjour", "accueil", "bienvenue", "mail", "courrier", "direction"];
const SERVICE_LOCALS = [
  "commercial",
  "vente",
  "ventes",
  "sales",
  "reservation",
  "reservations",
  "resa",
  "booking",
  "rdv",
  "devis",
  "sav",
  "support",
  "atelier",
  "secretariat",
  "compta",
  "comptabilite",
  "recrutement",
  "presse",
];

/** Priorité §7.3 : générique (0) > service (1) > nominatif (2). */
export function classifyEmail(email: string): { kind: EmailKind; priority: number } {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (GENERIC_LOCALS.includes(local)) return { kind: "email_generique", priority: 0 };
  if (SERVICE_LOCALS.includes(local)) return { kind: "email_service", priority: 1 };
  return { kind: "email_nominatif", priority: 2 };
}

export interface ExtractedSocial {
  platform: Platform;
  profileUrl: string;
  username?: string;
}

export function extractSocialLinks(html: string): ExtractedSocial[] {
  const out = new Map<string, ExtractedSocial>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1] ?? "";
    for (const platform of ["instagram", "tiktok", "facebook"] as const) {
      const parsed = parseProfileUrl(platform, href);
      if (parsed) {
        out.set(`${platform}:${parsed.canonicalUrl}`, {
          platform,
          profileUrl: parsed.canonicalUrl,
          username: parsed.username,
        });
      }
    }
    // YouTube : @handle ou /channel/
    const yt = /https?:\/\/(?:www\.)?youtube\.com\/(@[\w.-]+|channel\/[\w-]+)/i.exec(href);
    if (yt) {
      const path = yt[1]!;
      const url = `https://www.youtube.com/${path}`;
      out.set(`youtube:${url}`, {
        platform: "youtube",
        profileUrl: url,
        username: path.startsWith("@") ? path.slice(1) : undefined,
      });
    }
  }
  return [...out.values()];
}

/** Description utile à la personnalisation : meta description / og:description / title. */
export function extractDescription(html: string): string | undefined {
  const meta =
    /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html) ??
    /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']description["']/i.exec(html) ??
    /<meta\s+[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html);
  if (meta?.[1]) return decodeEntities(meta[1]).trim().slice(0, 1000);
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return title?.[1] ? decodeEntities(title[1]).trim().slice(0, 300) : undefined;
}

/** Liens internes plausibles vers contact / mentions légales. */
export function findContactLinks(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<a\s+[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>(.*?)<\/a>/gis)) {
    const href = m[1] ?? "";
    const text = (m[2] ?? "").replace(/<[^>]+>/g, "").toLowerCase();
    if (/contact|mentions?\s*l[ée]gales|legal/i.test(href) || /contact|mentions\s*l[ée]gales/.test(text)) {
      try {
        const abs = new URL(href, baseUrl);
        if (abs.origin === new URL(baseUrl).origin) found.push(abs.toString());
      } catch {
        // href invalide — ignoré
      }
    }
  }
  return [...new Set(found)];
}
