import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { settings } from "../db/schema.js";

/**
 * Paramètres applicatifs (table `settings`, une ligne clé/valeur jsonb).
 * Valeurs par défaut du §10 de la spécification.
 */

export const settingsSchema = z.object({
  // Pause générale = bouton STOP AUTOMATISATION (effet immédiat)
  automationPaused: z.boolean().default(false),
  // Mode revue : chaque email généré attend une validation humaine
  reviewMode: z.boolean().default(true),
  // Sources actives
  sources: z
    .object({
      places: z.boolean().default(true),
      youtube: z.boolean().default(true),
      cse_instagram: z.boolean().default(true),
      cse_tiktok: z.boolean().default(true),
      cse_facebook: z.boolean().default(true),
      osm: z.boolean().default(false),
    })
    .default({}),
  // Quotas de découverte
  discoveryDailyGlobal: z.number().int().min(0).default(40),
  discoveryDailyPerSource: z.number().int().min(0).default(10),
  // Quota email / jour (le warm-up s'applique par-dessus)
  emailDailyMax: z.number().int().min(0).default(30),
  // Warm-up progressif (désactivable)
  warmupEnabled: z.boolean().default(true),
  // Date de début du warm-up (YYYY-MM-DD, fixée au premier envoi)
  warmupStartDate: z.string().nullable().default(null),
  // Relance
  relanceEnabled: z.boolean().default(true),
  relanceDelaiJours: z.number().int().min(1).max(30).default(4),
  // Fenêtre d'envoi
  sendWindow: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]), // 1=lundi … 5=vendredi (0=dimanche)
      startHour: z.number().min(0).max(23).default(9),
      startMinute: z.number().min(0).max(59).default(30),
      endHour: z.number().min(0).max(23).default(18),
      endMinute: z.number().min(0).max(59).default(0),
    })
    .default({}),
  timezone: z.string().default("Europe/Paris"),
  // Intervalle aléatoire entre envois (minutes)
  sendIntervalMinMinutes: z.number().int().min(1).default(6),
  sendIntervalMaxMinutes: z.number().int().min(1).default(18),
  // IA
  aiProvider: z.enum(["anthropic", "openai", "gemini", "ollama"]).default("anthropic"),
  aiModel: z.string().default("claude-haiku-4-5"),
  // Contexte de l'expéditeur, injecté dans les prompts de personnalisation
  senderActivity: z
    .string()
    .default("Création de contenus vidéo courts (TikTok/Reels) pour entreprises locales"),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({});

const SETTINGS_KEY = "app";

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  const raw = rows[0]?.value ?? {};
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function updateSettings(db: Db, patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings(db);
  const next = settingsSchema.parse({ ...current, ...patch });
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: next, updatedAt: new Date() },
    });
  return next;
}

/** Le bouton STOP : vérifié au début de chaque job ET juste avant chaque envoi. */
export async function isAutomationPaused(db: Db): Promise<boolean> {
  return (await getSettings(db)).automationPaused;
}

export async function setAutomationPaused(db: Db, paused: boolean): Promise<void> {
  await updateSettings(db, { automationPaused: paused });
}
