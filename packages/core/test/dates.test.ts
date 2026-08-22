import { describe, expect, it } from "vitest";
import {
  daysBetweenLocalDates,
  isWithinSendWindow,
  localDateString,
  localMonthString,
  nextWindowStart,
} from "../src/dates.js";

const TZ = "Europe/Paris";
const WINDOW = { days: [1, 2, 3, 4, 5], startHour: 9, startMinute: 30, endHour: 18, endMinute: 0 };

describe("localDateString (Europe/Paris)", () => {
  it("bascule de jour à minuit local, pas à minuit UTC", () => {
    // 23:30 UTC le 14 juin = 01:30 le 15 juin à Paris (été, UTC+2)
    expect(localDateString(TZ, new Date("2025-06-14T23:30:00Z"))).toBe("2025-06-15");
    // 22:30 UTC le 14 juin = 00:30 le 15 juin à Paris
    expect(localDateString(TZ, new Date("2025-06-14T22:30:00Z"))).toBe("2025-06-15");
    // 21:30 UTC le 14 juin = 23:30 le 14 juin à Paris
    expect(localDateString(TZ, new Date("2025-06-14T21:30:00Z"))).toBe("2025-06-14");
  });
  it("gère l'heure d'hiver (UTC+1)", () => {
    // 23:30 UTC le 14 janvier = 00:30 le 15 janvier à Paris
    expect(localDateString(TZ, new Date("2025-01-14T23:30:00Z"))).toBe("2025-01-15");
    expect(localDateString(TZ, new Date("2025-01-14T22:30:00Z"))).toBe("2025-01-14");
  });
  it("mois local", () => {
    expect(localMonthString(TZ, new Date("2025-01-31T23:30:00Z"))).toBe("2025-02");
  });
});

describe("isWithinSendWindow", () => {
  it("accepte un mardi 10h00 à Paris", () => {
    // Mardi 17 juin 2025, 10:00 Paris = 08:00 UTC
    expect(isWithinSendWindow(WINDOW, TZ, new Date("2025-06-17T08:00:00Z"))).toBe(true);
  });
  it("refuse avant 09h30 et après 18h00", () => {
    // 09:00 Paris
    expect(isWithinSendWindow(WINDOW, TZ, new Date("2025-06-17T07:00:00Z"))).toBe(false);
    // 18:30 Paris
    expect(isWithinSendWindow(WINDOW, TZ, new Date("2025-06-17T16:30:00Z"))).toBe(false);
  });
  it("refuse le week-end", () => {
    // Samedi 21 juin 2025, 10:00 Paris
    expect(isWithinSendWindow(WINDOW, TZ, new Date("2025-06-21T08:00:00Z"))).toBe(false);
  });
});

describe("nextWindowStart", () => {
  it("reporte un vendredi soir au lundi matin", () => {
    // Vendredi 20 juin 2025, 19:00 Paris (17:00 UTC)
    const next = nextWindowStart(WINDOW, TZ, new Date("2025-06-20T17:00:00Z"));
    expect(localDateString(TZ, next)).toBe("2025-06-23"); // lundi
    expect(isWithinSendWindow(WINDOW, TZ, next)).toBe(true);
  });
  it("retourne l'instant lui-même s'il est déjà dans la fenêtre", () => {
    const inWindow = new Date("2025-06-17T08:00:00Z");
    expect(nextWindowStart(WINDOW, TZ, inWindow).getTime()).toBe(inWindow.getTime());
  });
});

describe("daysBetweenLocalDates", () => {
  it("compte les jours entiers", () => {
    expect(daysBetweenLocalDates("2025-06-01", "2025-06-05")).toBe(4);
    expect(daysBetweenLocalDates("2025-06-05", "2025-06-01")).toBe(-4);
  });
});
