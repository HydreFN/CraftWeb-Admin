import { STATUS_LABELS, schema, type ProspectStatus } from "@prospection/core";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Button, Card, Input, Select } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const FILTERS: { value: string; label: string }[] = [
  { value: "tous", label: "Tous" },
  ...(["INTERESSE", "DEMANDE_DE_PRIX", "PAS_INTERESSE", "A_RELANCER", "QUESTION", "EN_ATTENTE", "A_VERIFIER"] as const).map(
    (s) => ({ value: s, label: STATUS_LABELS[s] }),
  ),
  { value: "NOUVEAU", label: "Nouveau" },
  { value: "EMAIL_INVALIDE", label: "Email invalide" },
  { value: "EXCLU", label: "Exclu" },
];

const SOURCES = ["places", "youtube", "cse_instagram", "cse_tiktok", "cse_facebook", "osm", "manuel"];

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" }).format(d);
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; source?: string; q?: string }>;
}) {
  const params = await searchParams;
  const statut = params.statut ?? "tous";
  const source = params.source ?? "toutes";
  const q = params.q?.trim() ?? "";

  const conditions: SQL[] = [];
  if (statut !== "tous" && (schema.prospectStatusEnum.enumValues as string[]).includes(statut)) {
    conditions.push(eq(schema.prospects.status, statut as ProspectStatus));
  }
  if (source !== "toutes" && (schema.discoverySourceEnum.enumValues as string[]).includes(source)) {
    conditions.push(
      eq(schema.prospects.discoverySource, source as (typeof schema.discoverySourceEnum.enumValues)[number]),
    );
  }
  if (q) conditions.push(ilike(schema.prospects.companyName, `%${q}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const database = db();
  const rows = await database
    .select()
    .from(schema.prospects)
    .where(where)
    .orderBy(desc(schema.prospects.updatedAt))
    .limit(200);
  const [totalRow] = await database.select({ n: count() }).from(schema.prospects).where(where);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prospects ({totalRow?.n ?? 0})</h1>
        <Link href="/prospects/new">
          <Button>+ Nouveau prospect</Button>
        </Link>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Statut</label>
          <Select name="statut" defaultValue={statut} className="w-48">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Source</label>
          <Select name="source" defaultValue={source} className="w-44">
            <option value="toutes">Toutes</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Recherche</label>
          <Input name="q" defaultValue={q} placeholder="Nom d'entreprise…" />
        </div>
        <Button type="submit" variant="outline">
          Filtrer
        </Button>
      </form>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-4 py-2">Entreprise</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Dernière réponse</th>
              <th className="px-4 py-2">Découvert le</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Aucun prospect ne correspond à ces filtres.
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/prospects/${p.id}`} className="font-medium text-blue-700 hover:underline">
                    {p.companyName}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {[p.niche, p.locationCity].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs">{p.discoverySource}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-2">{fmtDate(p.lastInboundAt)}</td>
                <td className="px-4 py-2">{fmtDate(p.discoveredAt)}</td>
                <td className="px-4 py-2">
                  <Link href={`/prospects/${p.id}`} className="text-xs text-blue-600 hover:underline">
                    Ouvrir →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
