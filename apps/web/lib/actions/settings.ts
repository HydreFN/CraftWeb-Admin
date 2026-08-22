"use server";

import { logEvent, updateSettings, type AppSettings } from "@prospection/core";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

function num(formData: FormData, key: string, fallback: number): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : fallback;
}

export async function saveSettings(formData: FormData): Promise<void> {
  await requireSession();
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => formData.get(`day-${d}`) === "on");
  const patch: Partial<AppSettings> = {
    reviewMode: formData.get("reviewMode") === "on",
    sources: {
      places: formData.get("src-places") === "on",
      youtube: formData.get("src-youtube") === "on",
      cse_instagram: formData.get("src-cse_instagram") === "on",
      cse_tiktok: formData.get("src-cse_tiktok") === "on",
      cse_facebook: formData.get("src-cse_facebook") === "on",
      osm: formData.get("src-osm") === "on",
    },
    discoveryDailyGlobal: num(formData, "discoveryDailyGlobal", 40),
    discoveryDailyPerSource: num(formData, "discoveryDailyPerSource", 10),
    emailDailyMax: num(formData, "emailDailyMax", 30),
    warmupEnabled: formData.get("warmupEnabled") === "on",
    relanceEnabled: formData.get("relanceEnabled") === "on",
    relanceDelaiJours: num(formData, "relanceDelaiJours", 4),
    sendWindow: {
      days: days.length > 0 ? days : [1, 2, 3, 4, 5],
      startHour: num(formData, "startHour", 9),
      startMinute: num(formData, "startMinute", 30),
      endHour: num(formData, "endHour", 18),
      endMinute: num(formData, "endMinute", 0),
    },
    timezone: ((formData.get("timezone") as string | null) || "Europe/Paris").trim(),
    sendIntervalMinMinutes: num(formData, "sendIntervalMinMinutes", 6),
    sendIntervalMaxMinutes: num(formData, "sendIntervalMaxMinutes", 18),
    aiProvider: (formData.get("aiProvider") as AppSettings["aiProvider"]) || "anthropic",
    aiModel: ((formData.get("aiModel") as string | null) || "claude-haiku-4-5").trim(),
    senderActivity: ((formData.get("senderActivity") as string | null) ?? "").trim(),
  };
  // Cohérence intervalle
  if (patch.sendIntervalMaxMinutes! < patch.sendIntervalMinMinutes!) {
    patch.sendIntervalMaxMinutes = patch.sendIntervalMinMinutes;
  }
  await updateSettings(db(), patch);
  await logEvent(db(), "settings", "Paramètres mis à jour");
  revalidatePath("/parametres");
  revalidatePath("/");
}
