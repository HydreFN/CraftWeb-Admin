# LIMITATIONS.md — limites réelles de la V1 et alternatives conformes

Ce document liste honnêtement ce que la V1 ne fait **pas** (ou fait
différemment de ce qu'on pourrait imaginer), avec l'alternative conforme
retenue. Aucune fonction factice n'est présentée comme fonctionnelle.

## Plateformes sociales

- **Aucun envoi automatique de DM** (Instagram, TikTok, Facebook, YouTube).
  C'est un choix de conformité définitif, pas une limite temporaire : les CGU
  de ces plateformes interdisent l'automatisation des comptes. Alternative
  retenue : génération du message par IA + file « À envoyer manuellement »
  (copier → ouvrir le profil → envoyer soi-même → marquer envoyé).
- **Aucun scraping direct des plateformes.** Les profils sociaux sont
  découverts exclusivement via l'index Google (Programmable Search, moteurs
  restreints à chaque domaine), l'API officielle YouTube Data v3, et les
  liens publiés sur les sites officiels des entreprises.
- **Nombre d'abonnés** : fiable uniquement pour YouTube (API officielle).
  Pour Instagram/TikTok/Facebook, la V1 ne le collecte pas (les extraits
  Google sont trop peu fiables) — le champ reste vide plutôt que faux.
- **Email de la page « À propos » YouTube** : jamais récupéré (bouton protégé
  par CAPTCHA — l'automatiser violerait les CGU). Alternative : l'email est
  cherché sur le site officiel de l'entreprise (souvent lié depuis la chaîne).

## Découverte

- **Places API (New)** : les champs `websiteUri` / `nationalPhoneNumber`
  relèvent du SKU « Text Search Pro », gratuit jusqu'à un palier mensuel puis
  facturé. Le compteur interne `places:text_search_pro` alerte à 80 % du
  palier (page Recherche). Les seuils codés dans
  `packages/discovery/src/usage.ts` sont prudents : vérifiez les paliers en
  vigueur dans votre console Google Cloud.
- **Programmable Search** : 100 requêtes gratuites / jour. Les fiches créées
  depuis un extrait Google sont minimales (nom + profil social) tant que le
  site officiel n'a pas été trouvé.
- **CSE et pertinence** : l'index Google peut retourner des profils hors
  zone (la ville n'est qu'un mot-clé). La déduplication et la revue humaine
  compensent ; affinez les mots-clés si besoin.
- **OpenStreetMap (option, OFF par défaut)** : la correspondance
  secteur → tags OSM est approximative ; seules les fiches avec site web ou
  téléphone sont retenues. Données sous licence ODbL.
- **SIRET** : non collecté automatiquement en V1 (nécessiterait l'API
  INSEE/Sirene). Champ présent en base, remplissable à la main.

## Enrichissement

- Maximum **3 pages** par site (home + contact + mentions légales),
  `robots.txt` respecté, timeout 8 s, 500 Ko max — un site lent ou interdit
  d'accès n'est simplement pas enrichi.
- La **vérification MX** (DNS) confirme que le domaine reçoit des emails,
  pas que la boîte existe (la vérification SMTP « callout » est refusée par
  la plupart des serveurs et assimilable à de l'abus). Les hard bounces sont
  gérés a posteriori (exclusion + proposition de bascule).
- Les sites 100 % JavaScript (SPA sans HTML serveur) peuvent ne rien livrer
  à l'extraction : pas de navigateur headless en V1 (choix de sobriété, pas
  de contournement).

## Email

- **Opt-out V1 = réponse STOP** (détectée automatiquement, exclusion
  immédiate). L'application tournant en local sans URL publique, le lien de
  désinscription « one-click » HTTP n'est actif que si
  `UNSUBSCRIBE_PUBLIC_URL` est configurée (déploiement VPS futur). L'en-tête
  `List-Unsubscribe: <mailto:…?subject=STOP>` est présent dans chaque envoi.
- **Gmail gratuit = tests uniquement.** L'envoi commercial automatisé non
  sollicité viole les règles Gmail et fait bloquer le compte ; la
  délivrabilité sans domaine propre (SPF/DKIM/DMARC) est mauvaise. Voir
  README §4 pour la configuration production (domaine dédié + Zoho).
- La détection de bounces/réponses automatiques est heuristique (en-têtes +
  motifs). Les cas ambigus finissent en « À vérifier », jamais en action
  automatique.

## IA

- Fournisseurs **OpenAI / Gemini / Ollama : stubs documentés** (V2).
  L'interface `AIProvider` est le seul contrat — voir
  `packages/ai/src/stubs.ts` pour la marche à suivre.
- Sans clé `ANTHROPIC_API_KEY`, l'application reste fonctionnelle :
  templates neutres pour la génération, et toutes les réponses entrantes
  partent en « À vérifier » (classification humaine).
- La classification < 80 % de confiance ne déclenche **aucune** action
  automatique — c'est un garde-fou volontaire, pas un défaut.

## Divers

- **Mono-utilisateur** par conception (Better Auth, un seul compte).
- Le worker tourne via `tsx` (pas de binaire compilé) — adapté à une machine
  locale ou un petit VPS ; prévoir `systemd`/`pm2` pour un vrai déploiement.
- Les Routines/cron (pg-boss) tournent uniquement quand le worker est lancé :
  machine éteinte = aucune découverte ni envoi (comportement attendu en
  hébergement local).

## Checklist de conformité (§2 de la spécification)

| Règle | Où c'est appliqué |
|---|---|
| 1. Aucune automatisation de comptes sociaux, aucun DM auto, aucun scraping | `packages/channels/src/manual.ts` (mode manual, pas de `send`), sources = index Google + API YouTube + sites officiels uniquement |
| 2. Email caché YouTube (CAPTCHA) jamais récupéré | `packages/discovery/src/sources/youtube.ts` (API officielle seule) |
| 3. Aucune clé API en dur, secrets serveur uniquement | `.env` + Zod (`packages/core/src/config.ts`), `server-only` sur `lib/env.ts` |
| 4. Aucune fonction factice | ce fichier + stubs IA qui lèvent une erreur explicite |
| 5. Conformité B2B CNIL / L.34-5 CPCE | pied d'email obligatoire (`compliance.ts` : identité, origine de la donnée, droits, STOP), exclusion permanente, purge RGPD 36 mois (`housekeeping.ts`), pas d'import de listes |
| 6. La classification ne répond jamais automatiquement | `inbound.ts` : au mieux un brouillon `status=brouillon`, jamais envoyé |
| 7. Bouton STOP global à effet immédiat | `settings.automationPaused` vérifié au début de chaque job **et** juste avant chaque envoi (`sequencer.ts`) |
| 8. Quotas et CGU des API respectés | compteurs `daily_quotas` + `api_usage`, alertes 80 %, field mask minimal |
| 9. robots.txt, User-Agent identifiable, timeout, max 3 pages | `packages/discovery/src/enrichment/` |
