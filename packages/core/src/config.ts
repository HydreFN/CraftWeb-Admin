import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Validation de l'environnement (Zod).
 * Le process refuse de démarrer si l'environnement est invalide,
 * avec un message explicite listant chaque variable en cause.
 *
 * Aucune clé n'est jamais exposée côté frontend : ce module n'est
 * importé que par du code serveur (API routes, worker).
 */

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const portSchema = z.coerce.number().int().min(1).max(65535);

export const envSchema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL est requise (URL Postgres)" })
    .url("DATABASE_URL doit être une URL postgres:// valide"),
  AUTH_SECRET: z
    .string({ required_error: "AUTH_SECRET est requise (openssl rand -base64 32)" })
    .min(16, "AUTH_SECRET doit faire au moins 16 caractères"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  TZ: z.string().default("Europe/Paris"),

  // IA
  AI_PROVIDER: z.enum(["anthropic", "openai", "gemini", "ollama"]).default("anthropic"),
  AI_MODEL: z.string().default("claude-haiku-4-5"),
  ANTHROPIC_API_KEY: optionalStr,

  // Google — chaque clé absente désactive simplement la source concernée
  GOOGLE_MAPS_API_KEY: optionalStr,
  YOUTUBE_API_KEY: optionalStr,
  GOOGLE_CSE_API_KEY: optionalStr,
  GOOGLE_CSE_CX_INSTAGRAM: optionalStr,
  GOOGLE_CSE_CX_TIKTOK: optionalStr,
  GOOGLE_CSE_CX_FACEBOOK: optionalStr,

  // Email
  SMTP_HOST: optionalStr,
  SMTP_PORT: portSchema.default(465),
  SMTP_USER: optionalStr,
  SMTP_PASS: optionalStr,
  IMAP_HOST: optionalStr,
  IMAP_PORT: portSchema.default(993),
  IMAP_USER: optionalStr,
  IMAP_PASS: optionalStr,
  MAIL_FROM_NAME: optionalStr,
  MAIL_FROM_ADDRESS: optionalStr.pipe(z.string().email().optional()),

  UNSUBSCRIBE_PUBLIC_URL: optionalStr.pipe(z.string().url().optional()),
});

export type Env = z.infer<typeof envSchema>;

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromAddress: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

let cached: Env | null = null;
let dotenvLoaded = false;

/**
 * Charge le fichier .env le plus proche (répertoire courant puis parents,
 * jusqu'à la racine du monorepo). Les variables déjà présentes dans
 * l'environnement ont priorité. Sans dépendance externe.
 */
export function loadDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        let value = m[2]!;
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Parse et valide process.env. Lève une erreur explicite si invalide. */
export function loadConfig(env?: NodeJS.ProcessEnv): Env {
  if (!env) {
    loadDotenv();
    env = process.env;
  }
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(env)"} : ${i.message}`,
    );
    throw new Error(
      `Configuration invalide — le démarrage est refusé.\n` +
        `Corrigez le fichier .env (voir .env.example) :\n${lines.join("\n")}`,
    );
  }
  return parsed.data;
}

/** Version mise en cache pour usage applicatif. */
export function getConfig(): Env {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Config SMTP complète, ou null si l'envoi email n'est pas configuré. */
export function getSmtpConfig(env: Env = getConfig()): SmtpConfig | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.MAIL_FROM_ADDRESS) {
    return null;
  }
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    fromName: env.MAIL_FROM_NAME ?? env.MAIL_FROM_ADDRESS,
    fromAddress: env.MAIL_FROM_ADDRESS,
  };
}

/** Config IMAP complète, ou null si la réception n'est pas configurée. */
export function getImapConfig(env: Env = getConfig()): ImapConfig | null {
  if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASS) return null;
  return { host: env.IMAP_HOST, port: env.IMAP_PORT, user: env.IMAP_USER, pass: env.IMAP_PASS };
}
