import { schema } from "@prospection/core";
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import Link from "next/link";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from "@/components/ui";
import {
  approveEmailAction,
  choosePrimaryEmailAction,
  rejectEmailAction,
} from "@/lib/actions/review";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AVerifierPage() {
  const database = db();

  // 1. Emails en attente de revue (mode revue ON)
  const pendingEmails = await database
    .select({ msg: schema.messages, prospect: schema.prospects })
    .from(schema.messages)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.messages.prospectId))
    .where(eq(schema.messages.status, "en_attente_revue"))
    .orderBy(asc(schema.messages.createdAt));

  // 2. Choix d'email ambigu : prospects A_VERIFIER sans email principal
  const ambiguous = await database
    .select({ prospect: schema.prospects, contact: schema.contactChannels })
    .from(schema.prospects)
    .innerJoin(schema.contactChannels, eq(schema.contactChannels.prospectId, schema.prospects.id))
    .where(and(eq(schema.prospects.status, "A_VERIFIER"), eq(schema.contactChannels.mxValid, true)))
    .orderBy(asc(schema.prospects.updatedAt));
  const byProspect = new Map<string, { prospect: typeof schema.prospects.$inferSelect; contacts: (typeof schema.contactChannels.$inferSelect)[] }>();
  for (const row of ambiguous) {
    const entry = byProspect.get(row.prospect.id) ?? { prospect: row.prospect, contacts: [] };
    entry.contacts.push(row.contact);
    byProspect.set(row.prospect.id, entry);
  }
  const ambiguousProspects = [...byProspect.values()].filter(
    (e) => !e.contacts.some((c) => c.isPrimary) && e.contacts.length > 1,
  );

  // 3. Bascule après hard bounce : EMAIL_INVALIDE avec un email alternatif valide
  const bounced = await database
    .select({ prospect: schema.prospects, contact: schema.contactChannels })
    .from(schema.prospects)
    .innerJoin(schema.contactChannels, eq(schema.contactChannels.prospectId, schema.prospects.id))
    .where(
      and(eq(schema.prospects.status, "EMAIL_INVALIDE"), eq(schema.contactChannels.mxValid, true)),
    );
  const bouncedByProspect = new Map<
    string,
    { prospect: typeof schema.prospects.$inferSelect; contacts: (typeof schema.contactChannels.$inferSelect)[] }
  >();
  for (const row of bounced) {
    const entry = bouncedByProspect.get(row.prospect.id) ?? { prospect: row.prospect, contacts: [] };
    entry.contacts.push(row.contact);
    bouncedByProspect.set(row.prospect.id, entry);
  }
  const bounceProposals = [...bouncedByProspect.values()];

  // 4. Classifications IA < 80 non validées
  const lowConfidence = await database
    .select({
      classif: schema.classifications,
      msg: schema.messages,
      prospect: schema.prospects,
    })
    .from(schema.classifications)
    .innerJoin(schema.messages, eq(schema.messages.id, schema.classifications.messageId))
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.messages.prospectId))
    .where(eq(schema.classifications.humanValidated, false))
    .orderBy(asc(schema.classifications.createdAt));
  const toValidate = lowConfidence.filter((r) => r.classif.confidence < 80);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">À vérifier</h1>
      <p className="text-sm text-slate-500">
        Toutes les validations humaines : emails en attente de revue, choix d&apos;email ambigus,
        classifications IA sous le seuil de confiance.
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          ✉️ Emails en attente de revue ({pendingEmails.length})
        </h2>
        {pendingEmails.length === 0 && (
          <p className="text-sm text-slate-400">Aucun email en attente de validation.</p>
        )}
        {pendingEmails.map(({ msg, prospect }) => (
          <Card key={msg.id}>
            <CardHeader>
              <CardTitle>
                <Link href={`/prospects/${prospect.id}`} className="text-blue-700 hover:underline">
                  {prospect.companyName}
                </Link>{" "}
                → {msg.toAddress} {msg.sequenceStep === 1 && "· relance"}
                {msg.aiGenerated ? " · généré par IA" : " · template neutre"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={approveEmailAction.bind(null, msg.id)} className="space-y-2">
                <Input name="subject" defaultValue={msg.subject ?? ""} placeholder="Objet" />
                <Textarea name="body" rows={10} defaultValue={msg.bodyText} className="font-mono text-xs" />
                <div className="flex gap-2">
                  <Button type="submit" variant="success" size="sm">
                    ✓ Valider et planifier l&apos;envoi
                  </Button>
                </div>
              </form>
              <form action={rejectEmailAction.bind(null, msg.id)} className="mt-2">
                <ConfirmSubmit variant="outline" message="Rejeter ce message ? Il repassera en brouillon.">
                  ✗ Rejeter
                </ConfirmSubmit>
              </form>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          📧 Choix d&apos;email ambigu ({ambiguousProspects.length})
        </h2>
        {ambiguousProspects.length === 0 && (
          <p className="text-sm text-slate-400">Aucun choix d&apos;email en attente.</p>
        )}
        {ambiguousProspects.map(({ prospect, contacts }) => (
          <Card key={prospect.id}>
            <CardHeader>
              <CardTitle>
                <Link href={`/prospects/${prospect.id}`} className="text-blue-700 hover:underline">
                  {prospect.companyName}
                </Link>{" "}
                — plusieurs emails trouvés, aucun générique : lequel utiliser ?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contacts.map((c) => (
                <form key={c.id} action={choosePrimaryEmailAction.bind(null, prospect.id, c.id)} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm">
                    {c.value} <span className="text-xs text-slate-400">({c.type})</span>
                  </span>
                  <Button type="submit" variant="outline" size="sm">
                    Choisir
                  </Button>
                </form>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          📮 Bascule après bounce ({bounceProposals.length})
        </h2>
        {bounceProposals.length === 0 && (
          <p className="text-sm text-slate-400">Aucune bascule d&apos;email en attente.</p>
        )}
        {bounceProposals.map(({ prospect, contacts }) => (
          <Card key={prospect.id}>
            <CardHeader>
              <CardTitle>
                <Link href={`/prospects/${prospect.id}`} className="text-blue-700 hover:underline">
                  {prospect.companyName}
                </Link>{" "}
                — l&apos;email principal a rebondi (hard bounce). Basculer sur un autre email ?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contacts.map((c) => (
                <form
                  key={c.id}
                  action={choosePrimaryEmailAction.bind(null, prospect.id, c.id)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-mono text-sm">
                    {c.value} <span className="text-xs text-slate-400">({c.type})</span>
                  </span>
                  <Button type="submit" variant="outline" size="sm">
                    Basculer sur cet email
                  </Button>
                </form>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          🟣 Classifications IA à confirmer ({toValidate.length})
        </h2>
        {toValidate.length === 0 && (
          <p className="text-sm text-slate-400">
            Aucune classification sous le seuil de 80 % en attente.
          </p>
        )}
        {toValidate.map(({ classif, msg, prospect }) => (
          <Card key={classif.id}>
            <CardContent className="text-sm">
              <Link href={`/prospects/${prospect.id}`} className="font-medium text-blue-700 hover:underline">
                {prospect.companyName}
              </Link>{" "}
              — proposition : <b>{classif.label}</b> ({Math.round(classif.confidence)} %)
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
                « {msg.bodyText.slice(0, 300)} »
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Confirmez ou corrigez le statut depuis la fiche prospect (panneau Statut).
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
