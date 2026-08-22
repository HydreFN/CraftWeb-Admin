import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea } from "@/components/ui";
import { createProspect } from "@/lib/actions/prospects";

export const dynamic = "force-dynamic";

export default function NewProspectPage() {
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Nouveau prospect</h1>
      <Card>
        <CardHeader>
          <CardTitle>Création manuelle</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createProspect} className="space-y-3">
            <div>
              <Label htmlFor="companyName">Nom de l&apos;entreprise *</Label>
              <Input id="companyName" name="companyName" required maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="niche">Secteur</Label>
                <Input id="niche" name="niche" placeholder="garage, restaurant…" />
              </div>
              <div>
                <Label htmlFor="locationCity">Ville</Label>
                <Input id="locationCity" name="locationCity" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="websiteUrl">Site web</Label>
                <Input id="websiteUrl" name="websiteUrl" placeholder="https://…" />
              </div>
              <div>
                <Label htmlFor="phone">Téléphone</Label>
                <Input id="phone" name="phone" placeholder="04 72 …" />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email professionnel (si connu)</Label>
              <Input id="email" name="email" type="email" placeholder="contact@…" />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} />
            </div>
            <Button type="submit">Créer la fiche</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
