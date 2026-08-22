import {
  effectiveEmailQuota,
  getQuotaUsage,
  getSettings,
  isWithinSendWindow,
  localDateString,
} from "@prospection/core";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { StopButton } from "@/components/stop-button";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "📊 Dashboard" },
  { href: "/prospects", label: "👥 Prospects" },
  { href: "/recherche", label: "🔎 Recherche" },
  { href: "/file-manuelle", label: "✉️ File manuelle" },
  { href: "/a-verifier", label: "🟣 À vérifier" },
  { href: "/logs", label: "📜 Logs" },
  { href: "/parametres", label: "⚙️ Paramètres" },
];

async function automationState() {
  const database = db();
  const s = await getSettings(database);
  if (s.automationPaused) {
    return { label: "⛔ Automatisation EN PAUSE (STOP actif)", tone: "red", paused: true } as const;
  }
  const now = new Date();
  if (!isWithinSendWindow(s.sendWindow, s.timezone, now)) {
    return {
      label: "🌙 Hors fenêtre horaire — envois reportés au prochain créneau",
      tone: "slate",
      paused: false,
    } as const;
  }
  const today = localDateString(s.timezone, now);
  const quota = effectiveEmailQuota(s.emailDailyMax, s.warmupEnabled, s.warmupStartDate, today);
  const usage = await getQuotaUsage(database, "email", s.timezone, now);
  if (Number.isFinite(quota) && usage.used >= quota) {
    return {
      label: `⏸ Quota email du jour atteint (${usage.used}/${quota})`,
      tone: "amber",
      paused: false,
    } as const;
  }
  return { label: "🟢 Automatisation active", tone: "green", paused: false } as const;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const state = await automationState();
  const tones: Record<string, string> = {
    red: "bg-red-50 text-red-800 border-red-200",
    green: "bg-green-50 text-green-800 border-green-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-lg font-bold">Prospection IA</div>
          <div className="text-xs text-slate-500">B2B · conforme CNIL</div>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <LogoutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`flex items-center justify-between gap-4 border-b px-6 py-3 ${tones[state.tone]}`}
        >
          <span className="text-sm font-semibold">{state.label}</span>
          <StopButton paused={state.paused} />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
