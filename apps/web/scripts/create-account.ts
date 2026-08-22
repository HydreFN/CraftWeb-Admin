/**
 * Création du compte unique en ligne de commande :
 *   pnpm create-account -- --email vous@exemple.fr --password "votre-mdp" [--name "Votre Nom"]
 * Refuse si un compte existe déjà (mono-utilisateur).
 */
import { getDb, loadConfig, schema } from "@prospection/core";
import { count } from "drizzle-orm";
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      password: { type: "string" },
      name: { type: "string" },
    },
  });
  if (!values.email || !values.password) {
    console.error(
      'Usage : pnpm create-account -- --email vous@exemple.fr --password "mot-de-passe" [--name "Nom"]',
    );
    process.exit(1);
  }
  if (values.password.length < 8) {
    console.error("Le mot de passe doit faire au moins 8 caractères.");
    process.exit(1);
  }

  const env = loadConfig();
  const db = getDb(env.DATABASE_URL);
  const [row] = await db.select({ n: count() }).from(schema.user);
  if ((row?.n ?? 0) > 0) {
    console.error("Un compte existe déjà — l'application est mono-utilisateur.");
    process.exit(1);
  }

  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: env.AUTH_SECRET,
    baseURL: env.APP_BASE_URL,
    emailAndPassword: { enabled: true },
  });

  await auth.api.signUpEmail({
    body: {
      name: values.name ?? "Utilisateur",
      email: values.email,
      password: values.password,
    },
  });
  console.log(`Compte créé pour ${values.email} ✔`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
