import {
  effectiveEmailQuota,
  getQuotaUsage,
  getSettings,
  localDateString,
  warmupCap,
} from "@prospection/core";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Textarea } from "@/components/ui";
import { saveSettings } from "@/lib/actions/settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const SOURCE_LABELS: Record<string, string> = {
  places: "Google Places",
  youtube: "YouTube Data API",
  cse_instagram: "Google CSE — Instagram",
  cse_tiktok: "Google CSE — TikTok",
  cse_facebook: "Google CSE — Facebook",
  osm: "OpenStreetMap (Overpass)",
};

export default async function ParametresPage() {
  const database = db();
  const s = await getSettings(database);
  const today = localDateString(s.timezone);
  const emailQuota = effectiveEmailQuota(s.emailDailyMax, s.warmupEnabled, s.warmupStartDate, today);
  const emailUsage = await getQuotaUsage(database, "email", s.timezone);
  const cap = warmupCap(s.warmupStartDate, today);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Paramètres</h1>

      <Card>
        <CardContent className="flex items-center justify-between text-sm">
          <div>
            <div className="font-semibold">Quota email aujourd&apos;hui</div>
            <div className="text-slate-500">
              {emailUsage.used} envoyé(s) / {Number.isFinite(emailQuota) ? emailQuota : s.emailDailyMax} autorisés
              {s.warmupEnabled && Number.isFinite(cap) && (
                <> — warm-up actif : plafond {cap}/jour {s.warmupStartDate ? `(démarré le ${s.warmupStartDate})` : "(démarre au 1er envoi)"}</>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <form action={saveSettings} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Envoi d&apos;emails</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="reviewMode" defaultChecked={s.reviewMode} />
              <span>
                <b>Mode revue</b> — chaque email généré attend votre validation avant envoi (recommandé)
              </span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Emails / jour</Label>
                <Input name="emailDailyMax" type="number" min={0} max={200} defaultValue={s.emailDailyMax} />
              </div>
              <div>
                <Label>Intervalle min (min)</Label>
                <Input name="sendIntervalMinMinutes" type="number" min={1} defaultValue={s.sendIntervalMinMinutes} />
              </div>
              <div>
                <Label>Intervalle max (min)</Label>
                <Input name="sendIntervalMaxMinutes" type="number" min={1} defaultValue={s.sendIntervalMaxMinutes} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="warmupEnabled" defaultChecked={s.warmupEnabled} />
              <span>Warm-up progressif (~10/j semaine 1, 15 semaine 2, 22 semaine 3, puis plein régime)</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="relanceEnabled" defaultChecked={s.relanceEnabled} />
                <span>1 relance automatique</span>
              </label>
              <div>
                <Label>Délai de relance (jours)</Label>
                <Input name="relanceDelaiJours" type="number" min={1} max={30} defaultValue={s.relanceDelaiJours} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fenêtre d&apos;envoi (fuseau {s.timezone})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name={`day-${d}`} defaultChecked={s.sendWindow.days.includes(d)} />
                  {DAY_LABELS[d]}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label>Début (h)</Label>
                <Input name="startHour" type="number" min={0} max={23} defaultValue={s.sendWindow.startHour} />
              </div>
              <div>
                <Label>Début (min)</Label>
                <Input name="startMinute" type="number" min={0} max={59} defaultValue={s.sendWindow.startMinute} />
              </div>
              <div>
                <Label>Fin (h)</Label>
                <Input name="endHour" type="number" min={0} max={23} defaultValue={s.sendWindow.endHour} />
              </div>
              <div>
                <Label>Fin (min)</Label>
                <Input name="endMinute" type="number" min={0} max={59} defaultValue={s.sendWindow.endMinute} />
              </div>
            </div>
            <div>
              <Label>Fuseau horaire (IANA)</Label>
              <Input name="timezone" defaultValue={s.timezone} placeholder="Europe/Paris" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Découverte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`src-${key}`}
                    defaultChecked={s.sources[key as keyof typeof s.sources]}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nouveaux prospects / jour (global)</Label>
                <Input name="discoveryDailyGlobal" type="number" min={0} defaultValue={s.discoveryDailyGlobal} />
              </div>
              <div>
                <Label>Nouveaux prospects / jour (par source)</Label>
                <Input name="discoveryDailyPerSource" type="number" min={0} defaultValue={s.discoveryDailyPerSource} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intelligence artificielle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fournisseur</Label>
                <Select name="aiProvider" defaultValue={s.aiProvider}>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai" disabled>
                    OpenAI (V2)
                  </option>
                  <option value="gemini" disabled>
                    Gemini (V2)
                  </option>
                  <option value="ollama" disabled>
                    Ollama (V2)
                  </option>
                </Select>
              </div>
              <div>
                <Label>Modèle</Label>
                <Input name="aiModel" defaultValue={s.aiModel} />
              </div>
            </div>
            <div>
              <Label>Votre activité (contexte des messages générés)</Label>
              <Textarea name="senderActivity" rows={2} defaultValue={s.senderActivity} />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" size="lg">
          Enregistrer les paramètres
        </Button>
      </form>
    </div>
  );
}
