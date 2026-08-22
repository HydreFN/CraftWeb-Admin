import "server-only";
import { getConfig, type Env } from "@prospection/core";

/**
 * Accès serveur à la configuration validée (Zod) — évalué paresseusement
 * pour que `next build` fonctionne sans .env complet (les pages sont
 * dynamiques : la validation a lieu au démarrage du serveur).
 * Ce module ne doit JAMAIS être importé depuis un composant client :
 * l'import de "server-only" le garantit à la compilation.
 */
export function env(): Env {
  return getConfig();
}
