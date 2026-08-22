import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

/** Récupère la session ou redirige vers /login. À appeler dans les pages protégées. */
export async function requireSession() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}
