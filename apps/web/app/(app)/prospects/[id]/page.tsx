import { STATUS_LABELS, TAG_EMOJI, schema, type Tag } from "@prospection/core";
import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select, Textarea } from "@/components/ui";
import {
  addContactChannel,
  deleteProspect,
  excludeProspect,
  setPrimaryContact,
  setStatus,
  updateNotes,
} from "@/lib/actions/prospects";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(d);
}

const MSG_STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  en_attente_revue: "En attente de revue",
  planifie: "Planifié",
  envoi_en_cours: "Envoi en cours",
  envoye: "Envoyé",
  echec: "Échec",
  recu: "Reçu",
};

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = db();

  const [prospect] = await database.select().from(schema.prospects).where(eq(schema.prospects.id, id));
  if (!prospect) notFound();

  const [msgs, socials, contacts, history] = await Promise.all([
    database.select().from(schema.messages).where(eq(schema.messages.prospectId, id)).orderBy(asc(schema.messages.createdAt)),
    database.select().from(schema.socialProfiles).where(eq(schema.socialProfiles.prospectId, id)),
    database.select().from(schema.contactChannels).where(eq(schema.contactChannels.prospectId, id)),
    database
      .select()
      .from(schema.statusHistory)
      .where(eq(schema.statusHistory.prospectId, id))
      .orderBy(desc(schema.statusHistory.changedAt))
      .limit(20),
  ]);

  const inboundIds = msgs.filter((m) => m.direction === "entrant").map((m) => m.id);
  const classifs =
    inboundIds.length > 0
      ? await database
          .select()
          .from(schema.classifications)
          .where(inArray(schema.classifications.messageId, inboundIds))
      : [];
  const classifByMsg = new Map(classifs.map((c) => [c.messageId, c]));
  const lastClassif = classifs.sort(
    (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
  )[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/prospects" className="text-xs text-slate-500 hover:underline">
            ← Prospects
          </Link>
          <h1 className="text-2xl font-bold">{prospect.companyName}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <StatusBadge status={prospect.status} />
            <span>{[prospect.niche, prospect.locationCity].filter(Boolean).join(" · ")}</span>
            <span className="text-xs">source : {prospect.discoverySource}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Fil de conversation */}
        <div className="space-y-3 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {msgs.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">
                  Aucun message pour l&apos;instant.
                </p>
              )}
              {msgs.map((m) => {
                const c = classifByMsg.get(m.id);
                return (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg border p-3 text-sm ${
                      m.direction === "sortant"
                        ? "ml-auto border-blue-100 bg-blue-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                      <span>
                        {m.direction === "sortant" ? "→ Sortant" : "← Entrant"} · {m.channel}
                        {m.sequenceStep === 1 && " · relance"}
                        {m.aiGenerated && " · IA"}
                        {m.isAutoReply && " · réponse automatique"}
                        {m.isBounce && " · bounce"}
                      </span>
                      <span>
                        {MSG_STATUS_LABEL[m.status] ?? m.status} · {fmt(m.sentAt ?? m.createdAt)}
                      </span>
                    </div>
                    {m.subject && <div className="mb-1 font-semibold">{m.subject}</div>}
                    <div className="whitespace-pre-wrap">{m.bodyText}</div>
                    {c && (
                      <div className="mt-2 border-t border-slate-200 pt-1 text-xs text-slate-500">
                        Classification IA : {TAG_EMOJI[c.label as Tag] ?? ""} {c.label} ({Math.round(c.confidence)}
                        %){c.humanValidated && " · validée"}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Panneau latéral */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {prospect.websiteUrl && (
                <div>
                  🌐{" "}
                  <a href={prospect.websiteUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    {prospect.websiteDomain ?? prospect.websiteUrl}
                  </a>
                </div>
              )}
              {prospect.phone && <div>📞 {prospect.phone}</div>}
              {prospect.siret && <div>SIRET : {prospect.siret}</div>}
              {prospect.description && (
                <p className="pt-1 text-xs text-slate-500">{prospect.description}</p>
              )}
              <div className="pt-1 text-xs text-slate-400">
                Découvert le {fmt(prospect.discoveredAt)}
                {prospect.firstContactedAt && <> · 1er contact {fmt(prospect.firstContactedAt)}</>}
              </div>
              {lastClassif && (
                <div className="pt-1 text-xs">
                  Dernière classification : {TAG_EMOJI[lastClassif.label as Tag] ?? ""} {lastClassif.label} (
                  {Math.round(lastClassif.confidence)}%)
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profils sociaux</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {socials.length === 0 && <p className="text-xs text-slate-400">Aucun profil rattaché.</p>}
              {socials.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <a href={s.profileUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    {s.platform} {s.username ? `@${s.username}` : ""}
                  </a>
                  {s.followersCount != null && (
                    <span className="text-xs text-slate-400">{s.followersCount.toLocaleString("fr-FR")} abonnés</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emails connus</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {contacts.length === 0 && <p className="text-xs text-slate-400">Aucun email connu.</p>}
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs">{c.value}</div>
                    <div className="text-xs text-slate-400">
                      {c.type}
                      {c.mxValid === false && " · MX invalide"}
                      {c.isPrimary && " · principal"}
                    </div>
                  </div>
                  {!c.isPrimary && (
                    <form action={setPrimaryContact.bind(null, id, c.id)}>
                      <Button variant="outline" size="sm" type="submit">
                        Principal
                      </Button>
                    </form>
                  )}
                </div>
              ))}
              <form action={addContactChannel.bind(null, id)} className="flex gap-2 pt-1">
                <Input name="email" type="email" placeholder="ajouter@email.fr" required className="text-xs" />
                <Button variant="outline" size="sm" type="submit">
                  +
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Statut</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action={setStatus.bind(null, id)} className="flex gap-2">
                <Select name="status" defaultValue={prospect.status}>
                  {schema.prospectStatusEnum.enumValues.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
                <Button variant="outline" size="sm" type="submit">
                  OK
                </Button>
              </form>
              <div className="space-y-1 text-xs text-slate-500">
                {history.map((h) => (
                  <div key={h.id}>
                    {fmt(h.changedAt)} : {h.oldStatus ?? "—"} → <b>{h.newStatus}</b> ({h.changedBy})
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateNotes.bind(null, id)} className="space-y-2">
                <Textarea name="notes" rows={4} defaultValue={prospect.notes ?? ""} placeholder="Notes libres…" />
                <Button variant="outline" size="sm" type="submit">
                  Enregistrer
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zone dangereuse</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action={excludeProspect.bind(null, id)} className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" name="alsoDomain" /> Exclure aussi tout le domaine
                </label>
                <ConfirmSubmit message="Exclure définitivement ce prospect ? Ses emails seront ajoutés à la liste d'exclusion permanente.">
                  Exclure (liste d&apos;exclusion)
                </ConfirmSubmit>
              </form>
              <form action={deleteProspect.bind(null, id)}>
                <ConfirmSubmit
                  variant="outline"
                  message="Supprimer cette fiche et toute sa conversation ? (préférez l'exclusion pour un refus)"
                >
                  Supprimer la fiche
                </ConfirmSubmit>
              </form>
              {prospect.status === "EXCLU" && <Badge color="slate">EXCLU</Badge>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
