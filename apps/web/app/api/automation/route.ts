import { getSettings, logEvent, setAutomationPaused } from "@prospection/core";
import { NextResponse } from "next/server";
import { apiSession, unauthorized } from "@/lib/api-auth";
import { db } from "@/lib/db";

/** État de l'automatisation (bandeau). */
export async function GET() {
  if (!(await apiSession())) return unauthorized();
  const s = await getSettings(db());
  return NextResponse.json({ paused: s.automationPaused, reviewMode: s.reviewMode });
}

/**
 * Bouton STOP AUTOMATISATION : flag global à effet immédiat —
 * vérifié au début de chaque job ET juste avant chaque envoi.
 */
export async function POST(request: Request) {
  if (!(await apiSession())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { paused?: boolean };
  const paused = Boolean(body.paused);
  await setAutomationPaused(db(), paused);
  await logEvent(
    db(),
    "automation",
    paused ? "⛔ STOP AUTOMATISATION activé par l'utilisateur" : "▶️ Automatisation réactivée",
    {},
    paused ? "warn" : "info",
  );
  return NextResponse.json({ paused });
}
