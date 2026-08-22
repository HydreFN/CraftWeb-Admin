import { schema } from "@prospection/core";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ignoreDmAction, markDmSentAction } from "@/lib/actions/dm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "📸 Instagram",
  tiktok: "🎵 TikTok",
  facebook: "📘 Facebook",
  youtube: "▶️ YouTube",
};

export default async function FileManuellePage() {
  const database = db();
  const items = await database
    .select({
      dm: schema.manualDmQueue,
      prospect: schema.prospects,
    })
    .from(schema.manualDmQueue)
    .innerJoin(schema.prospects, eq(schema.prospects.id, schema.manualDmQueue.prospectId))
    .where(eq(schema.manualDmQueue.status, "a_envoyer"))
    .orderBy(asc(schema.manualDmQueue.createdAt));

  // URL du profil correspondant à la plateforme du DM
  const profileRows = await database.select().from(schema.socialProfiles);
  const profileByKey = new Map(profileRows.map((s) => [`${s.prospectId}:${s.platform}`, s]));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">File « À envoyer manuellement » ({items.length})</h1>
      </div>
      <p className="text-sm text-slate-500">
        Aucun DM n&apos;est jamais envoyé automatiquement : copiez le message, ouvrez le profil,
        envoyez-le vous-même depuis votre compte, puis marquez-le envoyé.
      </p>

      {items.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-slate-400">
            La file est vide. Elle se remplit quand un prospect découvert n&apos;a pas d&apos;email
            exploitable mais possède un profil social.
          </CardContent>
        </Card>
      )}

      {items.map(({ dm, prospect }) => {
        const profile = profileByKey.get(`${dm.prospectId}:${dm.platform}`);
        return (
          <Card key={dm.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                <Link href={`/prospects/${prospect.id}`} className="text-blue-700 hover:underline">
                  {prospect.companyName}
                </Link>{" "}
                <span className="ml-2 text-xs text-slate-400">
                  {[prospect.niche, prospect.locationCity].filter(Boolean).join(" · ")}
                </span>
              </CardTitle>
              <Badge color="blue">{PLATFORM_LABEL[dm.platform] ?? dm.platform}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm">{dm.messageText}</p>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={dm.messageText} />
                {profile && (
                  <a href={profile.profileUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">
                      🔗 Ouvrir le profil
                    </Button>
                  </a>
                )}
                <form action={markDmSentAction.bind(null, dm.id)}>
                  <Button type="submit" variant="success" size="sm">
                    ✓ Marquer envoyé
                  </Button>
                </form>
                <form action={ignoreDmAction.bind(null, dm.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Ignorer
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
