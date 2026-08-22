import pino from "pino";
import type { Db } from "../db/client.js";
import { appLogs } from "../db/schema.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
});

/**
 * Journalise un événement métier : pino (console) + table app_logs
 * (affichée dans l'interface). Ne lève jamais — un échec de log ne doit
 * pas faire échouer le job appelant.
 */
export async function logEvent(
  db: Db,
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
  level: "debug" | "info" | "warn" | "error" = "info",
): Promise<void> {
  logger[level]({ scope, ...meta }, message);
  try {
    await db.insert(appLogs).values({ level, scope, message, meta: meta ?? null });
  } catch (err) {
    logger.error({ err }, "Échec d'écriture dans app_logs");
  }
}
