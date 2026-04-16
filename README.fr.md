# Google Ads Agent — Extension Gemini CLI

**Langues :** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

> **Nouveauté v2.4 : connexion sans aucune configuration.** `/google-ads:login` délègue désormais l'intégralité du flow OAuth Google à [googleadsagent.ai](https://googleadsagent.ai) via son client OAuth déjà vérifié — **plus besoin de Google Cloud Console, de client ID ou de refresh token**. Seul un identifiant de session opaque est conservé localement dans le trousseau de votre OS. Les identités multiples restent supportées : `/google-ads:status`, `/google-ads:switch <email>`, `/google-ads:logout`. Les identités v2.3 continuent à fonctionner automatiquement. Détails dans le [README anglais](README.md#step-5-sign-in-30-seconds-any-google-account).

Une extension [Gemini CLI](https://github.com/google-gemini/gemini-cli) qui vous donne un **accès en direct à l’API Google Ads** depuis votre terminal. Posez des questions sur vos campagnes, repérez les dépenses inutiles, auditez des comptes, obtenez des recommandations d’optimisation — le tout par conversation naturelle.

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


Issue de l’expérience en production d’un agent Google Ads IA sur [googleadsagent.ai](https://googleadsagent.ai) — 28 actions API personnalisées, 6 sous-agents, gestion de comptes Google Ads réels via l’API Google Ads v23.


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## Démarrage rapide (5 minutes)

### Étape 1 : Installer Node.js (si besoin)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### Étape 2 : Installer Gemini CLI

```bash
npm install -g @google/gemini-cli
```

### Étape 3 : Obtenir une clé API Gemini (gratuit)

1. Allez sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Cliquez sur **Create API Key**
3. Copiez-la, puis enregistrez-la :

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

Le niveau gratuit offre 60 requêtes/minute et 1 000/jour — largement suffisant.

### Étape 4 : Installer cette extension

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

Vous devrez confirmer l’installation et saisir vos identifiants Google Ads (voir [Obtenir les identifiants](#obtenir-les-identifiants) ci-dessous). Les valeurs sensibles sont stockées dans le trousseau système.

### Étape 5 : Commencer à l’utiliser

```bash
gemini
```

C’est tout. L’extension se charge automatiquement à chaque fois. Posez simplement vos questions :

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## Exemples d’utilisation

Une fois installée, tapez `gemini` pour lancer le CLI interactif. Voici ce que vous pouvez faire :

### Poser des questions sur vos comptes (API en direct)

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### Repérer les problèmes

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### Modifier des éléments (API en direct — confirmation requise)

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### Faire les calculs (sans identifiants API)

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### Commandes slash

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### Changer de thème

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## Contenu de l’extension

Cette extension couvre chaque type de fonctionnalité du format d’extension Gemini CLI :

| Fonctionnalité | Contenu |
|---------|----------------|
| **Serveur MCP** | 22 outils — 15 lecture + 7 écriture avec accès direct à l’API Google Ads |
| **Commandes** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent` (expertise PPC + modèles GAQL) et `security-auditor` (analyse de vulnérabilités) |
| **Contexte** | `GEMINI.md` — référence API persistante chargée à chaque session |
| **Hooks** | Blocage des écritures GAQL + journalisation d’audit pour chaque appel d’outil |
| **Politiques** | Confirmation utilisateur avant toute exécution d’appel API |
| **Thèmes** | `google-ads` (sombre) et `google-ads-light` (clair) |
| **Paramètres** | 5 champs d’identifiants avec stockage des valeurs sensibles dans le trousseau système |

---

## Serveur MCP — 22 outils

### Outils de lecture (15)

Ces outils interrogent vos comptes Google Ads :

| Outil | Description |
|------|-------------|
| `list_accounts` | Lister tous les comptes sous votre MCC |
| `campaign_performance` | Dépenses, conversions, clics, impressions, CTR, CPC, CPA |
| `search_terms_report` | Analyse des requêtes de recherche avec détection des dépenses inutiles |
| `keyword_quality` | Scores de qualité avec détail des composants (créatif, page de destination, CTR attendu) |
| `ad_performance` | Performance des annonces et scores de force RSA |
| `budget_analysis` | Répartition des budgets, efficacité et campagnes limitées |
| `geo_performance` | Performance par zone géographique |
| `device_performance` | Performance par appareil — mobile, ordinateur, tablette |
| `impression_share` | Part d’impressions et opportunités perdues (budget ou rang) |
| `change_history` | Modifications récentes du compte — qui a changé quoi et quand |
| `list_recommendations` | Recommandations d’optimisation Google avec impact estimé |
| `compare_performance` | Comparaison entre périodes avec écarts (ex. ce mois vs le précédent) |
| `calculate` | Calculs Google Ads — projections de budget, ROAS, CPA, prévisions de conversions |
| `run_gaql` | Requêtes GAQL personnalisées (lecture seule — toutes les écritures bloquées) |
| `account_health` | Bilan de santé rapide avec détection automatique d’anomalies |

### Outils d’écriture (7)

Ces outils modifient votre compte Google Ads. **Chaque outil d’écriture exige votre confirmation explicite avant exécution.**

| Outil | Description |
|------|-------------|
| `pause_campaign` | Mettre en pause une campagne active (affiche l’état actuel d’abord) |
| `enable_campaign` | Réactiver une campagne en pause |
| `update_bid` | Modifier l’enchère CPC d’un groupe d’annonces (avant / après) |
| `update_budget` | Modifier le budget quotidien d’une campagne (avant / après + estimation mensuelle) |
| `add_negative_keywords` | Ajouter des mots-clés négatifs pour bloquer des requêtes indésirables (jusqu’à 50 à la fois) |
| `create_responsive_search_ad` | Créer une nouvelle RSA avec titres et descriptions (créée en PAUSED pour relecture) |
| `apply_recommendation` | Appliquer une suggestion d’optimisation Google |

### Sécurité

- **Lecture seule par défaut** : `run_gaql` n’autorise que les requêtes SELECT — CREATE, UPDATE, DELETE, MUTATE et REMOVE sont bloqués
- **Moteur de politiques** : chaque outil API exige votre confirmation avant exécution
- **Limitation de débit** : 10 appels par minute et par outil pour éviter les usages incontrôlés
- **Assainissement des erreurs** : les détails internes de l’API ne sont jamais exposés — messages d’erreur clairs et exploitables
- **Journal d’audit** : chaque appel d’outil est enregistré dans `~/.gemini/logs/google-ads-agent.log`

---

## Obtenir les identifiants

Vous avez besoin de **5 valeurs** provenant de **3 emplacements**. Configuration unique.

### Depuis Google Ads (2 valeurs)

1. Allez sur [ads.google.com](https://ads.google.com)
2. Cliquez sur **Tools & Settings** (icône clé) → **API Center**
3. Copiez votre **Developer Token**
4. Notez votre **Login Customer ID** — identifiant du compte MCC (Manager), le numéro à 10 chiffres en haut de la page (format : `123-456-7890`)

> **Pas d’accès API ?** Vous devrez [demander un developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). L’accès de base est en général accordé sous quelques jours.

### Depuis Google Cloud Console (2 valeurs)

1. Allez sur [console.cloud.google.com](https://console.cloud.google.com)
2. Créez un projet (ou sélectionnez-en un)
3. **APIs & Services** → **Library** → recherchez « Google Ads API » → **Enable**
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Choisissez **Web application** comme type d’application
6. Ajoutez `https://developers.google.com/oauthplayground` comme URI de redirection autorisée
7. Copiez votre **Client ID** et **Client Secret**

### Depuis OAuth Playground (1 valeur)

1. Allez sur [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)
2. Cliquez sur l’**icône engrenage** (en haut à droite) → cochez **Use your own OAuth credentials**
3. Collez votre **Client ID** et **Client Secret** de l’étape précédente
4. Dans le panneau de gauche, trouvez **Google Ads API v23** → sélectionnez `https://www.googleapis.com/auth/adwords`
5. Cliquez sur **Authorize APIs** → connectez-vous avec le compte Google ayant accès à Google Ads
6. Cliquez sur **Exchange authorization code for tokens**
7. Copiez le **Refresh Token**

### Saisir vos identifiants

```bash
gemini extensions config google-ads-agent
```

Chaque valeur sera demandée. Les champs sensibles (developer token, client secret, refresh token) sont stockés dans le trousseau système — pas en clair.

---

## Commandes

Trois commandes slash pour une analyse structurée :

```bash
# Deep-dive into a specific campaign or metric
/google-ads:analyze "Brand Search campaign performance last 30 days"

# Structured audit across 7 dimensions
/google-ads:audit "Acme Corp, focus on wasted spend and quality scores"

# Prioritized optimization recommendations
/google-ads:optimize "Improve ROAS for ecommerce campaigns"
```

## Skills

### Google Ads Agent
S’active automatiquement lorsque vous parlez de campagnes, budgets, mots-clés, annonces, PPC, ROAS, enchères ou Performance Max. Comprend :
- Modèles de requêtes GAQL pour les rapports courants
- Formatage des coûts (Google utilise les micros — la skill convertit en dollars)
- Seuils de détection d’anomalies (pics de CPA > 20 %, zéro conversion, plafonds de budget)
- Protocole d’écriture sécurisé : Confirmer → Exécuter → Vérification post-action

### Security Auditor
S’active lorsque vous demandez un audit sécurité, une recherche de secrets ou une analyse de vulnérabilités. Comprend :
- Plus de 10 motifs de secrets (sk-, AIzaSy, ghp_, AKIA, xox, whsec_, etc.)
- Contrôles d’auth/authz, validation des entrées, gestion des erreurs, chiffrement
- Niveaux de gravité (Critical / High / Medium / Low)

---

## Structure de l’extension

```
google-ads-gemini-extension/
├── gemini-extension.json       # Manifest — MCP server, settings, themes
├── GEMINI.md                   # Persistent context (loaded every session)
├── package.json                # Node.js dependencies
├── server.js                   # MCP server — 22 Google Ads API tools (15 read + 7 write)
├── commands/
│   └── google-ads/
│       ├── analyze.toml        # /google-ads:analyze
│       ├── audit.toml          # /google-ads:audit
│       └── optimize.toml       # /google-ads:optimize
├── skills/
│   ├── google-ads-agent/
│   │   └── SKILL.md            # PPC management expertise
│   └── security-auditor/
│       └── SKILL.md            # Security vulnerability scanning
├── hooks/
│   ├── hooks.json              # GAQL validation + audit logging
│   └── log-tool-call.js        # Audit trail logger
├── policies/
│   └── safety.toml             # User confirmation rules for all 22 tools (write tools at higher priority)
├── LICENSE
└── README.md
```

## Mise à jour

```bash
gemini extensions update google-ads-agent
```

## Désinstallation

```bash
gemini extensions uninstall google-ads-agent
```

## Développement local

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

Les changements se rechargent automatiquement — pas besoin de réinstaller.

## Dépannage

| Problème | Solution |
|---------|----------|
| `command not found: gemini` | Exécutez `npm install -g @google/gemini-cli` |
| `Please set an Auth method` | Créez `~/.gemini/.env` avec `GEMINI_API_KEY=your-key` ([obtenir une clé gratuite](https://aistudio.google.com/apikey)) |
| `Missing Google Ads credentials` | Exécutez `gemini extensions config google-ads-agent` |
| `Authentication failed` | Votre refresh token a peut-être expiré — régénérez-le dans [OAuth Playground](https://developers.google.com/oauthplayground/) |
| `Permission denied` | Vérifiez que le compte est accessible sous votre MCC |
| `Rate limit exceeded` | Attendez 60 secondes — l’extension limite à 10 appels/min par outil |

## Voir aussi

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — Anthropic Agent Skills pour Claude (analyse, audit, écriture, calculs, MCP)
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — Serveur MCP Python avec 29 outils
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Agent Python complet avec 28 actions API et 6 sous-agents
- [googleadsagent.ai](https://googleadsagent.ai) — Système de production (Buddy) sur Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## Licence

MIT
