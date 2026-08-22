"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, CardContent, Input, Label } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/bootstrap-account")
      .then((r) => r.json())
      .then((d) => setNeedsBootstrap(Boolean(d.needsBootstrap)))
      .catch(() => setNeedsBootstrap(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsBootstrap) {
        const res = await fetch("/api/bootstrap-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name || "Utilisateur", email, password }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Création du compte impossible");
        }
      }
      const { error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError) throw new Error(signInError.message ?? "Identifiants invalides");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <h1 className="mb-1 text-xl font-bold">Prospection IA</h1>
          <p className="mb-5 text-sm text-slate-500">
            {needsBootstrap
              ? "Premier démarrage : créez votre compte unique."
              : "Connectez-vous pour accéder au tableau de bord."}
          </p>
          <form onSubmit={onSubmit} className="space-y-3">
            {needsBootstrap && (
              <div>
                <Label htmlFor="name">Nom</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Votre nom"
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={needsBootstrap ? "new-password" : "current-password"}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || needsBootstrap === null}>
              {busy ? "…" : needsBootstrap ? "Créer le compte et se connecter" : "Se connecter"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
