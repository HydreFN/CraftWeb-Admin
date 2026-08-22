/**
 * Utilitaires de dates locales (fuseau configurable, Europe/Paris par défaut).
 * Fonctions pures — testées unitairement (changement de jour à minuit local,
 * heure d'été/hiver gérée par Intl).
 */

export interface SendWindow {
  days: number[]; // 0=dimanche … 6=samedi
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

/** Date locale YYYY-MM-DD dans le fuseau donné. */
export function localDateString(tz: string, date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // en-CA → YYYY-MM-DD
}

/** Mois local YYYY-MM dans le fuseau donné. */
export function localMonthString(tz: string, date: Date = new Date()): string {
  return localDateString(tz, date).slice(0, 7);
}

/** Composantes locales (année, mois, jour, heure, minute, jour de semaine). */
export function localParts(tz: string, date: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // Intl peut retourner "24" à minuit
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** true si l'instant donné est dans la fenêtre d'envoi autorisée. */
export function isWithinSendWindow(window: SendWindow, tz: string, date: Date = new Date()): boolean {
  const p = localParts(tz, date);
  if (!window.days.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  const start = window.startHour * 60 + window.startMinute;
  const end = window.endHour * 60 + window.endMinute;
  return minutes >= start && minutes < end;
}

/**
 * Prochain instant (>= from) situé dans la fenêtre d'envoi.
 * Recherche par pas de 15 minutes sur 14 jours maximum — suffisant et robuste
 * face aux changements d'heure.
 */
export function nextWindowStart(window: SendWindow, tz: string, from: Date = new Date()): Date {
  if (window.days.length === 0) {
    throw new Error("Fenêtre d'envoi vide : aucun jour autorisé");
  }
  const step = 15 * 60 * 1000;
  let t = from.getTime();
  const limit = t + 14 * 24 * 60 * 60 * 1000;
  while (t <= limit) {
    const d = new Date(t);
    if (isWithinSendWindow(window, tz, d)) return d;
    t += step;
  }
  throw new Error("Aucun créneau d'envoi trouvé dans les 14 prochains jours");
}

/** Nombre de jours entiers entre deux dates locales YYYY-MM-DD. */
export function daysBetweenLocalDates(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}
