import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "./auth";

/** Garde d'authentification pour les API routes internes. */
export async function apiSession() {
  const session = await auth().api.getSession({ headers: await headers() });
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
}
