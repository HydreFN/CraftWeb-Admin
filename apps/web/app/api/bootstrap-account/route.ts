import { schema } from "@prospection/core";
import { count } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8, "8 caractères minimum"),
});

/**
 * Création du compte unique (mono-utilisateur).
 * Refusée dès qu'un utilisateur existe : il n'y a jamais d'inscription
 * publique — ce point d'entrée ne sert qu'au tout premier démarrage.
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 },
    );
  }

  const [row] = await db().select({ n: count() }).from(schema.user);
  if ((row?.n ?? 0) > 0) {
    return NextResponse.json(
      { error: "Un compte existe déjà — connectez-vous." },
      { status: 403 },
    );
  }

  await auth().api.signUpEmail({
    body: {
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
    },
  });
  return NextResponse.json({ ok: true });
}

/** Indique au client si le formulaire de création doit être proposé. */
export async function GET() {
  const [row] = await db().select({ n: count() }).from(schema.user);
  return NextResponse.json({ needsBootstrap: (row?.n ?? 0) === 0 });
}
