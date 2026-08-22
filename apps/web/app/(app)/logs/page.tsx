import { schema } from "@prospection/core";
import { desc } from "drizzle-orm";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<string, "gray" | "blue" | "amber" | "red"> = {
  debug: "gray",
  info: "blue",
  warn: "amber",
  error: "red",
};

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(d);
}

export default async function LogsPage() {
  const database = db();
  const logs = await database
    .select()
    .from(schema.appLogs)
    .orderBy(desc(schema.appLogs.createdAt))
    .limit(150);
  const events = await database
    .select()
    .from(schema.events)
    .orderBy(desc(schema.events.createdAt))
    .limit(50);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Logs & événements</h1>

      <Card>
        <CardHeader>
          <CardTitle>Événements métier (app_logs)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {logs.length === 0 && <p className="text-sm text-slate-400">Aucun log.</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 border-b border-slate-50 py-1 text-xs">
              <span className="w-32 shrink-0 text-slate-400">{fmt(l.createdAt)}</span>
              <Badge color={LEVEL_COLOR[l.level] ?? "gray"}>{l.level}</Badge>
              <span className="w-24 shrink-0 text-slate-500">{l.scope}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Table events (outbox — consommée par les modules V2)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {events.length === 0 && <p className="text-sm text-slate-400">Aucun événement.</p>}
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-2 border-b border-slate-50 py-1 text-xs">
              <span className="w-32 shrink-0 text-slate-400">{fmt(e.createdAt)}</span>
              <span className="w-44 shrink-0 font-mono text-slate-700">{e.type}</span>
              <span className="min-w-0 break-words font-mono text-slate-400">
                {JSON.stringify(e.payload).slice(0, 140)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
