import { appLogs, getSettings } from "@prospection/core";
import { buildSources, getMonthlyUsage } from "@prospection/discovery";
import { desc, eq } from "drizzle-orm";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { runDiscoveryNow, saveSearchCriteria } from "@/lib/actions/discovery";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const NICHES = [
  "garage",
  "detailing",
  "restaurant",
  "barbier",
  "salle de sport",
  "agence immobilière",
  "location auto",
  "hôtel",
  "artisan",
  "commerce local",
];

export default async function RecherchePage({
  searchParams,
}: {
  searchParams: Promise<{ crees?: string; fusionnes?: string; erreur?: string }>;
}) {
  const params = await searchParams;
  const database = db();
  const settings = await getSettings(database);
  const criteria = settings.searchCriteria;
  const sources = buildSources(database, env(), { places: true, youtube: true, cse_instagram: true, cse_tiktok: true, cse_facebook: true, osm: true });
  const usage = await getMonthlyUsage(database, settings.timezone);
  const logs = await database
    .select()
    .from(appLogs)
    .where(eq(appLogs.scope, "discovery"))
    .orderBy(desc(appLogs.createdAt))
    .limit(10);

  const isCustomSector = Boolean(criteria.sector) && !NICHES.includes(criteria.sector);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Recherche de prospects</h1>

      {params.crees !== undefined && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="text-sm text-green-800">
            Cycle terminé : {params.crees} fiche(s) créée(s), {params.fusionnes} fusionnée(s) avec des
            fiches existantes.
          </CardContent>
        </Card>
      )}
      {params.erreur && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="text-sm text-red-800">
            {params.erreur === "stop"
              ? "L'automatisation est en pause (STOP actif) — relancez-la d'abord."
              : `Cycle non lancé : ${params.erreur}`}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Critères de découverte</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveSearchCriteria} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Pays</Label>
                <Input name="country" defaultValue={criteria.country} placeholder="FR" />
              </div>
              <div>
                <Label>Ville / région *</Label>
                <Input name="city" defaultValue={criteria.city} placeholder="Lyon" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Secteur</Label>
                <Select name="sector" defaultValue={isCustomSector ? "" : criteria.sector}>
                  <option value="">— Choisir —</option>
                  {NICHES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>… ou secteur personnalisé</Label>
                <Input
                  name="sectorCustom"
                  defaultValue={isCustomSector ? criteria.sector : ""}
                  placeholder="ex. fleuriste"
                />
              </div>
            </div>
            <div>
              <Label>Mots-clés additionnels</Label>
              <Input name="keywords" defaultValue={criteria.keywords} placeholder="ex. véhicules anciens" />
            </div>
            <div className="flex gap-3">
              <Button type="submit" variant="outline">
                Enregistrer les critères
              </Button>
            </div>
          </form>
          <form action={runDiscoveryNow} className="mt-3">
            <Button type="submit">🔎 Lancer un cycle maintenant</Button>
            <p className="mt-1 text-xs text-slate-500">
              Petits lots (≤ 5 par source), quotas du jour respectés. Le worker relance
              automatiquement des cycles toutes les ~25 min pendant la fenêtre autorisée.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources actives</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {sources.map((s) => {
            const enabled = settings.sources[s.id as keyof typeof settings.sources];
            return (
              <div key={s.id} className="flex items-center justify-between">
                <span>{s.id}</span>
                <span className="text-xs">
                  {!enabled ? (
                    <span className="text-slate-400">désactivée (paramètres)</span>
                  ) : s.isConfigured() ? (
                    <span className="text-green-700">✔ prête</span>
                  ) : (
                    <span className="text-amber-700">clé API manquante (.env)</span>
                  )}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage API du mois (paliers gratuits)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {usage.length === 0 && <p className="text-xs text-slate-400">Aucun appel API ce mois-ci.</p>}
          {usage.map((u) => (
            <div key={u.key} className="flex items-center justify-between">
              <span title={u.note ?? undefined}>{u.key}</span>
              <span className={u.limit && u.used / u.limit >= 0.8 ? "font-semibold text-red-600" : ""}>
                {u.used}
                {u.limit ? ` / ${u.limit}` : ""}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Derniers cycles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-slate-600">
          {logs.length === 0 && <p className="text-slate-400">Aucun cycle pour l&apos;instant.</p>}
          {logs.map((l) => (
            <div key={l.id}>
              {l.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} — {l.message}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
