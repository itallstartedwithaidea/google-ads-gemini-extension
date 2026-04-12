# Google Ads Agent — Gemini CLI-extensie

**Talen:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

Een [Gemini CLI](https://github.com/google-gemini/gemini-cli)-extensie die je **live toegang tot de Google Ads API** geeft vanuit je terminal. Stel vragen over campagnes, vind verspilde uitgaven, audit accounts en krijg optimalisatieadvies — allemaal via natuurlijke conversatie.

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


Gebouwd op productie-inzichten van een AI Google Ads-agent op [googleadsagent.ai](https://googleadsagent.ai) — 28 aangepaste API-acties, 6 subagents, beheer van echte Google Ads-accounts via de Google Ads API v22.


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## Snelstart (5 minuten)

### Stap 1: Node.js installeren (als je het nog niet hebt)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### Stap 2: Gemini CLI installeren

```bash
npm install -g @google/gemini-cli
```

### Stap 3: Gemini API-sleutel ophalen (gratis)

1. Ga naar [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Klik op **Create API Key**
3. Kopieer de sleutel en sla hem op:

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

De gratis tier biedt 60 requests/minuut en 1.000/dag — ruim voldoende.

### Stap 4: Deze extensie installeren

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

Je wordt gevraagd de installatie te bevestigen en je Google Ads-referenties in te voeren (zie [Referenties ophalen](#referenties-ophalen) hieronder). Gevoelige waarden worden opgeslagen in de systeem-sleutelhanger.

### Stap 5: Aan de slag

```bash
gemini
```

Dat is alles. De extensie laadt elke keer automatisch. Stel gewoon vragen:

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## Gebruiksvoorbeelden

Na installatie typ je `gemini` om de interactieve CLI te starten. Dit kun je doen:

### Vragen over je accounts (live API)

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### Problemen vinden

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### Wijzigingen doorvoeren (live API — bevestiging vereist)

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### Rekenen (geen API-referenties nodig)

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### Slash-commando’s

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### Thema’s wisselen

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## Wat zit erin

Deze extensie dekt elk functietype uit de Gemini CLI-extensiespecificatie:

| Functie | Inhoud |
|---------|----------------|
| **MCP-server** | 22 tools — 15 lezen + 7 schrijven met live Google Ads API-toegang |
| **Commando’s** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent` (PPC-expertise + GAQL-sjablonen) en `security-auditor` (kwetsbaarheidsscan) |
| **Context** | `GEMINI.md` — blijvende API-referentie die elke sessie wordt geladen |
| **Hooks** | GAQL-schrijfblokkering + auditlogging bij elke toolaanroep |
| **Beleid** | Gebruikersbevestiging vereist voordat een API-aanroep wordt uitgevoerd |
| **Thema’s** | `google-ads` (donker) en `google-ads-light` (licht) |
| **Instellingen** | 5 referentievelden met opslag van gevoelige waarden in de systeem-sleutelhanger |

---

## MCP-server — 22 tools

### Leestools (15)

Deze tools bevragen je Google Ads-accounts:

| Tool | Beschrijving |
|------|-------------|
| `list_accounts` | Alle accounts onder je MCC weergeven |
| `campaign_performance` | Uitgaven, conversies, klikken, vertoningen, CTR, CPC, CPA |
| `search_terms_report` | Zoektermenanalyse met detectie van verspilde uitgaven |
| `keyword_quality` | Kwaliteitsscores met onderdelen (creatief, landingspagina, verwachte CTR) |
| `ad_performance` | Prestaties van advertentiemateriaal en RSA-sterkte |
| `budget_analysis` | Budgetverdeling, efficiëntie en campagnes met budgetbeperking |
| `geo_performance` | Prestaties per geografische locatie |
| `device_performance` | Prestaties per apparaat — mobiel, desktop, tablet |
| `impression_share` | Impressieaandeel en gemiste kansen door budget of positie |
| `change_history` | Recente accountwijzigingen — wie wat wanneer heeft aangepast |
| `list_recommendations` | Google-optimalisatieaanbevelingen met geschatte impact |
| `compare_performance` | Vergelijking tussen perioden met verschillen (bijv. deze maand vs vorige) |
| `calculate` | Google Ads-rekenwerk — budgetprojecties, ROAS, CPA, conversieprognoses |
| `run_gaql` | Aangepaste GAQL-query’s (alleen-lezen — alle schrijfacties geblokkeerd) |
| `account_health` | Snelle gezondheidscheck met automatische anomaliedetectie |

### Schrijftools (7)

Deze tools wijzigen je Google Ads-account. **Elke schrijftool vereist je expliciete bevestiging voordat deze wordt uitgevoerd.**

| Tool | Beschrijving |
|------|-------------|
| `pause_campaign` | Een actieve campagne pauzeren (toont eerst de huidige status) |
| `enable_campaign` | Een gepauzeerde campagne weer inschakelen |
| `update_bid` | De CPC-bod voor een advertentiegroep wijzigen (voor/na) |
| `update_budget` | Het dagbudget van een campagne wijzigen (voor/na + maandschatting) |
| `add_negative_keywords` | Negatieve zoekwoorden toevoegen (tot 50 tegelijk) |
| `create_responsive_search_ad` | Een nieuwe RSA met koppen en beschrijvingen (aangemaakt als PAUSED voor review) |
| `apply_recommendation` | Een van Google’s optimalisatiesuggesties toepassen |

### Veiligheid

- **Standaard alleen-lezen**: `run_gaql` staat alleen SELECT toe — CREATE, UPDATE, DELETE, MUTATE en REMOVE zijn geblokkeerd
- **Beleidsengine**: elke API-tool vereist je bevestiging voordat deze draait
- **Snelheidslimiet**: 10 aanroepen per minuut per tool om runaway-gebruik te voorkomen
- **Foutsanitisatie**: interne API-details worden nooit getoond — je krijgt heldere, bruikbare foutmeldingen
- **Auditlog**: elke toolaanroep wordt gelogd in `~/.gemini/logs/google-ads-agent.log`

---

## Referenties ophalen

Je hebt **5 waarden** uit **3 plekken** nodig. Eenmalige setup.

### Van Google Ads (2 waarden)

1. Ga naar [ads.google.com](https://ads.google.com)
2. Klik op **Tools & Settings** (moersleutelpictogram) → **API Center**
3. Kopieer je **Developer Token**
4. Noteer je **Login Customer ID** — dit is je MCC (Manager)-account-ID, het 10-cijferige nummer bovenaan (formaat: `123-456-7890`)

> **Nog geen API-toegang?** Je moet een [developer token aanvragen](https://developers.google.com/google-ads/api/docs/get-started/dev-token). Basis-toegang wordt meestal binnen enkele dagen goedgekeurd.

### Van Google Cloud Console (2 waarden)

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com)
2. Maak een project aan (of selecteer een bestaand project)
3. Ga naar **APIs & Services** → **Library** → zoek op "Google Ads API" → **Enable**
4. Ga naar **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Kies **Web application** als applicatietype
6. Voeg `https://developers.google.com/oauthplayground` toe als geautoriseerde redirect-URI
7. Kopieer je **Client ID** en **Client Secret**

### Van OAuth Playground (1 waarde)

1. Ga naar [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)
2. Klik op het **tandwielpictogram** (rechtsboven) → vink **Use your own OAuth credentials** aan
3. Plak je **Client ID** en **Client Secret** van de vorige stap
4. Zoek in het linkerpaneel **Google Ads API v22** → selecteer `https://www.googleapis.com/auth/adwords`
5. Klik op **Authorize APIs** → log in met het Google-account dat toegang heeft tot Google Ads
6. Klik op **Exchange authorization code for tokens**
7. Kopieer de **Refresh Token**

### Referenties invoeren

```bash
gemini extensions config google-ads-agent
```

Je wordt per waarde gevraagd. Gevoelige velden (developer token, client secret, refresh token) worden in de systeem-sleutelhanger opgeslagen — niet als platte tekst.

---

## Commando’s

Drie slash-commando’s voor gestructureerde analyses:

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
Wordt automatisch actief bij vragen over campagnes, budgetten, zoekwoorden, advertenties, PPC, ROAS, biedstrategieën of Performance Max. Bevat:
- GAQL-querysjablonen voor veelvoorkomende rapporten
- Kostenformattering (Google gebruikt micros — de skill zet dit om naar dollars)
- Drempels voor anomaliedetectie (CPA-stijging >20%, geen conversies, budgetlimieten)
- Veilig schrijfprotocol: Bevestigen → Uitvoeren → Nazorg

### Security Auditor
Wordt actief bij vragen over security-audits, geheimen scannen of kwetsbaarheden. Bevat:
- 10+ geheimpatronen (sk-, AIzaSy, ghp_, AKIA, xox, whsec_, enz.)
- Controles op auth/authz, invoervalidatie, foutafhandeling, encryptie
- Ernstniveaus (Critical / High / Medium / Low)

---

## Extensiestructuur

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

## Bijwerken

```bash
gemini extensions update google-ads-agent
```

## Verwijderen

```bash
gemini extensions uninstall google-ads-agent
```

## Lokale ontwikkeling

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

Wijzigingen worden automatisch herladen — opnieuw installeren is niet nodig.

## Probleemoplossing

| Probleem | Oplossing |
|---------|----------|
| `command not found: gemini` | Voer `npm install -g @google/gemini-cli` uit |
| `Please set an Auth method` | Maak `~/.gemini/.env` met `GEMINI_API_KEY=your-key` ([gratis sleutel](https://aistudio.google.com/apikey)) |
| `Missing Google Ads credentials` | Voer `gemini extensions config google-ads-agent` uit |
| `Authentication failed` | Je refresh token is mogelijk verlopen — genereer opnieuw in [OAuth Playground](https://developers.google.com/oauthplayground/) |
| `Permission denied` | Controleer of het account onder je MCC bereikbaar is |
| `Rate limit exceeded` | Wacht 60 seconden — de extensie limiteert tot 10 aanroepen/min per tool |

## Gerelateerd

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — Anthropic Agent Skills voor Claude (analyse, audit, schrijven, rekenen, MCP)
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — Python MCP-server met 29 tools
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Volledige Python-agent met 28 API-acties en 6 subagents
- [googleadsagent.ai](https://googleadsagent.ai) — Live productiesysteem (Buddy) op Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## Licentie

MIT
