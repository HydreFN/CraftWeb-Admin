"use server";

import { getSettings, updateSettings } from "@prospection/core";
import { runDiscoveryCycle } from "@prospection/discovery";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";

export async function saveSearchCriteria(formData: FormData): Promise<void> {
  await requireSession();
  const sector = ((formData.get("sector") as string | null) || "").trim();
  const sectorCustom = ((formData.get("sectorCustom") as string | null) || "").trim();
  await updateSettings(db(), {
    searchCriteria: {
      country: ((formData.get("country") as string | null) || "FR").trim(),
      city: ((formData.get("city") as string | null) || "").trim(),
      sector: sectorCustom || sector,
      keywords: ((formData.get("keywords") as string | null) || "").trim(),
    },
  });
  revalidatePath("/recherche");
}

/**
 * Lance UN cycle de découverte immédiatement (petits lots, quotas
 * respectés). Les cycles récurrents sont gérés par le worker (cron).
 */
export async function runDiscoveryNow(): Promise<void> {
  await requireSession();
  const database = db();
  const settings = await getSettings(database);
  if (settings.automationPaused) {
    redirect("/recherche?erreur=stop");
  }
  const summary = await runDiscoveryCycle(database, env(), {});
  const created = summary.sources.reduce((a, s) => a + s.created, 0);
  const merged = summary.sources.reduce((a, s) => a + s.merged, 0);
  revalidatePath("/recherche");
  revalidatePath("/prospects");
  if (!summary.ran) {
    redirect(`/recherche?erreur=${encodeURIComponent(summary.reason ?? "inconnu")}`);
  }
  redirect(`/recherche?crees=${created}&fusionnes=${merged}`);
}
