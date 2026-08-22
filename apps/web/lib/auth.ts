import "server-only";
import { schema } from "@prospection/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { env } from "./env";

/**
 * Better Auth — mono-utilisateur, email + mot de passe.
 * L'inscription publique est désactivée : le compte unique est créé
 * soit depuis la page de connexion (uniquement si aucun compte n'existe),
 * soit via `pnpm create-account`.
 */
let _auth: ReturnType<typeof betterAuth> | null = null;

export function auth() {
  if (_auth) return _auth;
  const e = env();
  _auth = betterAuth({
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: e.AUTH_SECRET,
    baseURL: e.APP_BASE_URL,
    emailAndPassword: {
      enabled: true,
      // L'inscription passe par /api/bootstrap-account qui vérifie
      // qu'aucun utilisateur n'existe encore (mono-utilisateur).
      disableSignUp: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 jours (poste local de l'utilisateur)
    },
  });
  return _auth;
}
