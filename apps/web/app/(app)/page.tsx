import {
  STATUS_LABELS,
  getSettings,
  localParts,
  schema,
  type ProspectStatus,
} from "@prospection/core";
import { and, count, desc, eq, gte, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-1.5">
      {data.length === 0 && <p className="text-xs text-slate-400">Aucune donnée.</p>}
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-xs">
          <span className="w-36 shrink-0 truncate text-slate-600">{d.label}</span>
          <div className="h-4 flex-1 rounded bg-slate-100">
            <div
              className="h-4 rounded bg-blue-500"
              style={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 0)}%` }}
            />
          </div>
          <span className="w-8 text-right font-medium">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const database = db();
  const settings = await getSettings(database);
  const now = new Date();
  const p = localParts(settings.timezone, now);
  const startOfToday = new Date(now.getTime() - (p.hour * 60 + p.minute) * 60000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);

  const [
    [totalRow],
    byStatus,
    bySource,
    [sentToday],
    [sentWeek],
    [contacted],
    [responded],
    [queueRow],
    hot,
  ] = await Promise.all([
    database.select({ n: count() }).from(schema.prospects),
    database
      .select({ status: schema.prospects.status, n: count() })
      .from(schema.prospects)
      .groupBy(schema.prospects.status),
    database
      .select({ source: schema.prospects.discoverySource, n: count() })
      .from(schema.prospects)
      .groupBy(schema.prospects.discoverySource),
    database
      .select({ n: count() })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.direction, "sortant"),
          eq(schema.messages.channel, "email"),
          eq(schema.messages.status, "envoye"),
          gte(schema.messages.sentAt, startOfToday),
        ),
      ),
    database
      .select({ n: count() })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.direction, "sortant"),
          eq(schema.messages.channel, "email"),
          eq(schema.messages.status, "envoye"),
          gte(schema.messages.sentAt, startOfWeek),
        ),
      ),
    database
      .select({ n: count() })
      .from(schema.prospects)
      .where(isNotNull(schema.prospects.firstContactedAt)),
    database
      .select({ n: count() })
      .from(schema.prospects)
      .where(isNotNull(schema.prospects.lastInboundAt)),
    database
      .select({ n: count() })
      .from(schema.manualDmQueue)
      .where(eq(schema.manualDmQueue.status, "a_envoyer")),
    database
      .select()
      .from(schema.prospects)
      .where(isNotNull(schema.prospects.lastInboundAt))
      .orderBy(desc(schema.prospects.lastInboundAt))
      .limit(5),
  ]);

  const statusCount = (s: ProspectStatus) => byStatus.find((r) => r.status === s)?.n ?? 0;
  const nContacted = contacted?.n ?? 0;
  const nResponded = responded?.n ?? 0;
  const interested = statusCount("INTERESSE");
  const price = statusCount("DEMANDE_DE_PRIX");
  const tauxReponse = nContacted > 0 ? Math.round((nResponded / nContacted) * 100) : null;
  const tauxInteret = nResponded > 0 ? Math.round(((interested + price) / nResponded) * 100) : null;

  const highlights = hot.filter((h) => h.status === "INTERESSE" || h.status === "DEMANDE_DE_PRIX");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tableau de bord</h1>

      {highlights.length > 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardContent>
            <div className="mb-1 text-sm font-semibold text-green-900">
              🎉 Prospects chauds à traiter
            </div>
            <div className="flex flex-wrap gap-3">
              {highlights.map((h) => (
                <Link
                  key={h.id}
                  href={`/prospects/${h.id}`}
                  className="flex items-center gap-2 rounded-md border border-green-200 bg-white px-3 py-1.5 text-sm hover:bg-green-100"
                >
                  <StatusBadge status={h.status} /> {h.companyName}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Prospects trouvés" value={totalRow?.n ?? 0} />
        <StatCard label="Emails aujourd'hui" value={sentToday?.n ?? 0} hint={`cette semaine : ${sentWeek?.n ?? 0}`} />
        <StatCard label="Réponses totales" value={nResponded} hint={`${nContacted} contactés`} />
        <StatCard label="🟢 Intéressés" value={interested} />
        <StatCard label="💰 Demandes de prix" value={price} />
        <StatCard label="🔴 Pas intéressés" value={statusCount("PAS_INTERESSE")} />
        <StatCard label="⚪ En attente" value={statusCount("EN_ATTENTE")} />
        <StatCard label="✉️ File manuelle" value={queueRow?.n ?? 0} />
        <StatCard
          label="Taux de réponse"
          value={tauxReponse === null ? "—" : `${tauxReponse} %`}
          hint="réponses ÷ contactés"
        />
        <StatCard
          label="Taux d'intérêt"
          value={tauxInteret === null ? "—" : `${tauxInteret} %`}
          hint="(🟢+💰) ÷ réponses"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Répartition par statut</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={byStatus
                .sort((a, b) => b.n - a.n)
                .map((r) => ({ label: STATUS_LABELS[r.status], value: r.n }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Répartition par source de découverte</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={bySource.sort((a, b) => b.n - a.n).map((r) => ({ label: r.source, value: r.n }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
