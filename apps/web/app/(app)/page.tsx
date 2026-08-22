import { STATUS_LABELS, schema } from "@prospection/core";
import { count, eq } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const database = db();
  const [totalRow] = await database.select({ n: count() }).from(schema.prospects);
  const byStatus = await database
    .select({ status: schema.prospects.status, n: count() })
    .from(schema.prospects)
    .groupBy(schema.prospects.status);
  const [queueRow] = await database
    .select({ n: count() })
    .from(schema.manualDmQueue)
    .where(eq(schema.manualDmQueue.status, "a_envoyer"));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tableau de bord</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent>
            <div className="text-xs text-slate-500">Prospects trouvés</div>
            <div className="text-2xl font-bold">{totalRow?.n ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs text-slate-500">File manuelle</div>
            <div className="text-2xl font-bold">{queueRow?.n ?? 0}</div>
          </CardContent>
        </Card>
        {byStatus.map((s) => (
          <Card key={s.status}>
            <CardContent>
              <div className="text-xs text-slate-500">{STATUS_LABELS[s.status]}</div>
              <div className="text-2xl font-bold">{s.n}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-slate-500">
        Le tableau de bord complet (graphiques, taux de réponse et d&apos;intérêt) est disponible
        une fois les premières campagnes lancées.
      </p>
    </div>
  );
}
