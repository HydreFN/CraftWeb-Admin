# Prospection IA

Système de prospection commerciale B2B assistée par IA, **conforme aux règles
des plateformes et au droit français** (doctrine CNIL / art. L.34-5 CPCE) :

- découverte d'entreprises locales via des sources légales (Google Places,
  YouTube Data API, index Google Programmable Search, option OpenStreetMap) ;
- fiches prospects dans un CRM avec vue conversation ;
- enrichissement depuis le **site officiel** (email pro, réseaux, description) ;
- emails B2B personnalisés par IA (quotas, fenêtres horaires, warm-up,
  1 relance, STOP/désinscription, liste d'exclusion permanente, mode revue) ;
- pas d'email exploitable → message généré pour le réseau social, placé dans
  une file **« À envoyer manuellement »** — *aucun DM n'est jamais envoyé
  automatiquement* ;
- réception IMAP, filtrage des bounces/réponses automatiques, classification
  IA en 7 catégories 🟢💰🔴🟡🔵⚪🟣 avec score de confiance (< 80 % →
  validation humaine).

Consultez [`LIMITATIONS.md`](./LIMITATIONS.md) pour les limites réelles et la
checklist de conformité.

---

## 1. Prérequis et premier lancement

Ce guide suppose que vous partez de zéro (aucun outil installé).

### 1.1 Installer les prérequis

1. **Node.js 20 ou plus** : téléchargez l'installeur sur
   [nodejs.org](https://nodejs.org) (version LTS) et installez-le.
2. **pnpm** (gestionnaire de paquets) : dans un terminal :
   ```bash
   npm install -g pnpm
   ```
3. **Docker Desktop** : téléchargez-le sur
   [docker.com](https://www.docker.com/products/docker-desktop/) et lancez-le
   (il doit tourner en arrière-plan — icône baleine).

### 1.2 Installer et démarrer l'application

Dans un terminal, depuis le dossier du projet :

```bash
# 1. Installer les dépendances
pnpm install

# 2. Démarrer PostgreSQL (base de données locale, via Docker)
docker compose up -d

# 3. Créer votre fichier de configuration
cp .env.example .env
# Ouvrez .env dans un éditeur de texte et remplissez au minimum :
#   AUTH_SECRET  → collez le résultat de :  openssl rand -base64 32
# (DATABASE_URL par défaut fonctionne avec le docker compose fourni)

# 4. Créer les tables
pnpm db:migrate

# 5. (Optionnel) Insérer des données de démonstration
pnpm db:seed

# 6. Lancer l'application (interface web + worker)
pnpm dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) : au **premier
démarrage**, la page de connexion vous propose de créer votre compte unique
(email + mot de passe). L'application est mono-utilisateur : aucune
inscription publique n'existe.

> Alternative en ligne de commande :
> `pnpm create-account -- --email vous@exemple.fr --password "votre-mdp"`

---

## 2. Créer les clés Google Cloud

Toutes les clés se collent dans le fichier `.env` (jamais dans le code).
Chaque clé absente **désactive simplement la source concernée** — vous pouvez
commencer avec une seule.

### 2.1 Projet Google Cloud (commun)

1. Allez sur [console.cloud.google.com](https://console.cloud.google.com) et
   connectez-vous avec un compte Google.
2. En haut à gauche, cliquez sur le sélecteur de projet → **« Nouveau
   projet »** → nommez-le (ex. `prospection-ia`) → **Créer**.
3. Vérifiez que ce projet est bien sélectionné (son nom apparaît en haut).

### 2.2 Places API (découverte d'entreprises locales)

1. Menu ☰ → **« API et services » → « Bibliothèque »**.
2. Cherchez **« Places API (New) »** → **Activer**. (Google demandera
   d'associer un compte de facturation : nécessaire même pour le palier
   gratuit.)
3. Menu ☰ → **« API et services » → « Identifiants »** → **« Créer des
   identifiants » → « Clé API »**.
4. Cliquez sur la clé créée → **« Restrictions relatives aux API »** →
   cochez uniquement *Places API (New)* → Enregistrer.
5. Collez la clé dans `.env` : `GOOGLE_MAPS_API_KEY=...`

> ⚠️ Les champs *site web* et *téléphone* relèvent d'un palier facturé
> au-delà du seuil gratuit mensuel. L'application compte vos requêtes et
> vous alerte à 80 % (page Recherche) — surveillez aussi votre console
> Google Cloud.

### 2.3 YouTube Data API v3

1. **Bibliothèque** → cherchez **« YouTube Data API v3 »** → **Activer**.
2. **Identifiants** → **« Créer des identifiants » → « Clé API »** →
   restreignez-la à *YouTube Data API v3*.
3. Collez-la dans `.env` : `YOUTUBE_API_KEY=...`
   (Quota gratuit : 10 000 unités/jour ; une recherche = 100 unités —
   compteur visible page Recherche.)

### 2.4 Programmable Search (profils Instagram / TikTok / Facebook via l'index Google)

1. **Bibliothèque** → cherchez **« Custom Search API »** → **Activer**.
2. **Identifiants** → créez une **Clé API** restreinte à *Custom Search API*
   → `.env` : `GOOGLE_CSE_API_KEY=...`
3. Créez **3 moteurs de recherche** sur
   [programmablesearchengine.google.com](https://programmablesearchengine.google.com) :
   1. **« Ajouter »** → nom : `Instagram` → « Rechercher sur des sites
      spécifiques » → ajoutez `instagram.com/*` → **Créer**.
   2. Ouvrez le moteur créé → panneau **« Présentation »** → copiez
      l'**ID du moteur de recherche** (`cx`) → `.env` :
      `GOOGLE_CSE_CX_INSTAGRAM=...`
   3. Répétez pour `tiktok.com/*` → `GOOGLE_CSE_CX_TIKTOK=...`
      et `facebook.com/*` → `GOOGLE_CSE_CX_FACEBOOK=...`

(Quota gratuit : 100 requêtes/jour, toutes recherches confondues.)

---

## 3. Créer la clé Anthropic (IA)

1. Créez un compte sur [console.anthropic.com](https://console.anthropic.com).
2. **Settings → API keys → Create key** → copiez la clé (`sk-ant-…`).
3. `.env` :
   ```
   AI_PROVIDER=anthropic
   AI_MODEL=claude-haiku-4-5
   ANTHROPIC_API_KEY=sk-ant-...
   ```

Sans clé, l'application fonctionne quand même : messages issus de templates
neutres et classification des réponses déléguée à votre validation (page
« À vérifier »).

---

## 4. Configurer l'email (SMTP/IMAP universel)

### Chemin A — Tests (Gmail gratuit)

> **⚠️ RÉSERVÉ AUX TESTS. Ne prospectez pas avec un Gmail gratuit :**
> **l'envoi commercial automatisé non sollicité viole les règles Google et**
> **peut faire bloquer votre compte, et la délivrabilité sans domaine propre**
> **est mauvaise.** Utilisez-le uniquement pour vérifier le fonctionnement,
> vers vos propres adresses.

1. Activez la **validation en deux étapes** sur votre compte Google
   ([myaccount.google.com/security](https://myaccount.google.com/security)).
2. Toujours dans Sécurité → cherchez **« Mots de passe des applications »**
   → créez-en un (nom libre, ex. `prospection`) → copiez les 16 caractères.
3. `.env` :
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=votreadresse@gmail.com
   SMTP_PASS=le-mot-de-passe-application-16-caracteres
   IMAP_HOST=imap.gmail.com
   IMAP_PORT=993
   IMAP_USER=votreadresse@gmail.com
   IMAP_PASS=le-mot-de-passe-application-16-caracteres
   MAIL_FROM_NAME=Votre Nom
   MAIL_FROM_ADDRESS=votreadresse@gmail.com
   ```

### Chemin B — Production (recommandé) : domaine dédié + Zoho Mail Lite

1. **Achetez un domaine dédié** (~12 €/an, ex. chez OVH, Gandi ou
   Cloudflare) — idéalement une variante de votre marque
   (ex. `votremarque-studio.fr`), jamais votre domaine principal.
2. Créez une boîte **Zoho Mail Lite** sur
   [zoho.com/mail](https://www.zoho.com/mail/) → « Ajouter un domaine » →
   suivez l'assistant de vérification (ajout d'un enregistrement TXT chez
   votre registrar).
3. **Configurez le DNS** chez votre registrar (zone DNS du domaine) — Zoho
   affiche les valeurs exactes dans *Admin Console → Domains → votre domaine* :
   - **MX** : `mx.zoho.eu` (priorité 10), `mx2.zoho.eu` (20), `mx3.zoho.eu` (50)
   - **SPF** (TXT sur `@`) : `v=spf1 include:zohomail.eu ~all`
   - **DKIM** : Zoho génère un enregistrement TXT `zmail._domainkey` →
     copiez-le tel quel.
   - **DMARC** (TXT sur `_dmarc`) :
     `v=DMARC1; p=quarantine; rua=mailto:vous@votredomaine.fr`
   - Attendez la propagation (minutes à quelques heures) et vérifiez que
     Zoho affiche tout en vert.
4. Créez l'adresse d'envoi (ex. `contact@votredomaine.fr`) puis `.env` :
   ```
   SMTP_HOST=smtp.zoho.eu
   SMTP_PORT=465
   SMTP_USER=contact@votredomaine.fr
   SMTP_PASS=votre-mot-de-passe-zoho
   IMAP_HOST=imap.zoho.eu
   IMAP_PORT=993
   IMAP_USER=contact@votredomaine.fr
   IMAP_PASS=votre-mot-de-passe-zoho
   MAIL_FROM_NAME=Votre Nom
   MAIL_FROM_ADDRESS=contact@votredomaine.fr
   ```
   (Si l'IMAP Zoho refuse la connexion : activez IMAP dans
   *Zoho Mail → Settings → Mail Accounts → IMAP*.)

**Basculer de A à B = changer uniquement les variables email du `.env`**,
puis redémarrer (`pnpm dev`). Le warm-up (10 → 15 → 22 emails/jour) repart
naturellement en douceur avec la nouvelle adresse.

---

## 5. Première campagne (mode revue)

1. **Paramètres** : vérifiez le mode revue (ON par défaut), les quotas, la
   fenêtre lundi-vendredi 09h30-18h00, et décrivez **votre activité** (champ
   utilisé pour personnaliser les messages).
2. **Recherche** : choisissez ville + secteur (ex. Lyon + garage) →
   « Enregistrer les critères » → « Lancer un cycle maintenant ». Le worker
   relancera ensuite des cycles automatiquement toutes les ~25 min pendant la
   fenêtre autorisée.
3. Les fiches apparaissent dans **Prospects** (statut *Nouveau*), s'enrichissent
   automatiquement, puis :
   - email trouvé → un email est généré et attend dans **À vérifier** →
     relisez, modifiez si besoin, **Valider** → il part au prochain créneau ;
   - pas d'email → un message social arrive dans **File manuelle** →
     copiez-le, ouvrez le profil, envoyez-le vous-même, « Marquer envoyé ».
4. **Dashboard** : suivez envois, réponses, taux de réponse/intérêt et les
   prospects 🟢/💰 mis en avant. Les réponses sont relevées toutes les
   2 minutes et classées automatiquement (sous 80 % de confiance → votre
   validation dans **À vérifier**).
5. **STOP** : le gros bouton rouge en haut coupe **immédiatement** toute
   l'automatisation (découverte, enrichissement, envois). La lecture des
   réponses continue pour honorer les désinscriptions. Un prospect qui répond
   « STOP » est exclu définitivement, automatiquement.

## Commandes utiles

```bash
pnpm dev          # web (localhost:3000) + worker
pnpm build        # build complet (typecheck + Next.js)
pnpm test         # toute la suite de tests
pnpm db:migrate   # appliquer les migrations
pnpm db:seed      # données de démonstration
docker compose up -d / down   # base de données
```

## Architecture (extensibilité V2)

Monorepo pnpm : `apps/web` (Next.js App Router), `apps/worker` (jobs pg-boss),
`packages/core` (schéma Drizzle, config Zod, services), `packages/discovery`
(sources + déduplication + enrichissement), `packages/channels` (email auto,
sociaux manuels, séquenceur, inbound), `packages/ai` (interface `AIProvider`
+ AnthropicProvider + stubs OpenAI/Gemini/Ollama).

Chaque changement métier alimente la table **`events`** (pattern outbox,
visible page Logs) : les modules V2 (réponses automatiques validées, devis,
paiement, production…) consommeront ces événements **sans modifier le cœur
V1** — c'est le critère n° 1 de qualité de l'architecture.
