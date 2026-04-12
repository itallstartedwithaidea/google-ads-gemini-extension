# Google Ads Agent — Gemini CLI Extension

**Languages:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

A [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension that gives you **live Google Ads API access** from your terminal. Ask questions about your campaigns, find wasted spend, audit accounts, get optimization recommendations — all through natural conversation.

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


Built from production learnings running an AI Google Ads agent at [googleadsagent.ai](https://googleadsagent.ai) — 28 custom API actions, 6 sub-agents, managing real Google Ads accounts via the Google Ads API v22.


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## Quick Start (5 minutes)

### Step 1: Install Node.js (if you don't have it)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### Step 2: Install Gemini CLI

```bash
npm install -g @google/gemini-cli
```

### Step 3: Get a Gemini API key (free)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **Create API Key**
3. Copy it, then save it:

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

The free tier gives you 60 requests/minute and 1,000/day — more than enough.

### Step 4: Install this extension

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

You'll be prompted to confirm the install and enter your Google Ads credentials (see [Getting Credentials](#getting-credentials) below). Sensitive values are stored in your system keychain.

### Step 5: Start using it

```bash
gemini
```

That's it. The extension auto-loads every time. Just start asking questions:

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## Usage Examples

Once installed, type `gemini` to launch the interactive CLI. Here's what you can do:

### Ask about your accounts (live API)

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### Find problems

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### Make changes (live API — confirmation required)

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### Do the math (no API credentials needed)

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### Slash commands

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### Switch themes

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## What's Included

This extension implements every feature type in the Gemini CLI extension spec:

| Feature | What's included |
|---------|----------------|
| **MCP Server** | 22 tools — 15 read + 7 write with live Google Ads API access |
| **Commands** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent` (PPC expertise + GAQL templates) and `security-auditor` (vulnerability scanning) |
| **Context** | `GEMINI.md` — persistent API reference loaded every session |
| **Hooks** | GAQL write-blocking + audit logging for every tool call |
| **Policies** | User confirmation required before any API call executes |
| **Themes** | `google-ads` (dark) and `google-ads-light` (light) |
| **Settings** | 5 credential fields with system keychain storage for sensitive values |

---

## MCP Server — 22 Tools

### Read Tools (15)

These tools query your Google Ads accounts:

| Tool | Description |
|------|-------------|
| `list_accounts` | List all accounts under your MCC |
| `campaign_performance` | Spend, conversions, clicks, impressions, CTR, CPC, CPA |
| `search_terms_report` | Search terms analysis with wasted spend detection |
| `keyword_quality` | Quality scores with component breakdowns (creative, landing page, expected CTR) |
| `ad_performance` | Ad creative performance and RSA strength scores |
| `budget_analysis` | Budget allocation, efficiency, and limited campaign detection |
| `geo_performance` | Performance breakdown by geographic location |
| `device_performance` | Performance by device — mobile, desktop, tablet |
| `impression_share` | Impression share and lost opportunity from budget or rank |
| `change_history` | Recent account changes — who changed what and when |
| `list_recommendations` | Google's optimization recommendations with estimated impact |
| `compare_performance` | Period-over-period comparison with deltas (e.g., this month vs last) |
| `calculate` | Google Ads math — budget projections, ROAS, CPA, conversion forecasts |
| `run_gaql` | Custom GAQL queries (read-only — all write operations blocked) |
| `account_health` | Quick health check with automatic anomaly detection |

### Write Tools (7)

These tools make changes to your Google Ads account. **Every write tool requires your explicit confirmation before executing.**

| Tool | Description |
|------|-------------|
| `pause_campaign` | Pause an active campaign (shows current status first) |
| `enable_campaign` | Re-enable a paused campaign |
| `update_bid` | Change the CPC bid for an ad group (shows before/after) |
| `update_budget` | Change a campaign's daily budget (shows before/after + monthly estimate) |
| `add_negative_keywords` | Add negative keywords to block unwanted search terms (up to 50 at a time) |
| `create_responsive_search_ad` | Build a new RSA with headlines and descriptions (created PAUSED for review) |
| `apply_recommendation` | Apply one of Google's optimization suggestions |

### Safety

- **Read-only by default**: `run_gaql` only allows SELECT queries — CREATE, UPDATE, DELETE, MUTATE, and REMOVE are all blocked
- **Policy engine**: Every API tool requires your confirmation before it runs
- **Rate limiting**: 10 calls per minute per tool to prevent runaway usage
- **Error sanitization**: Internal API details are never exposed — you get clean, actionable error messages
- **Audit logging**: Every tool call is logged to `~/.gemini/logs/google-ads-agent.log`

---

## Getting Credentials

You need **5 values** from **3 places**. This is a one-time setup.

### From Google Ads (2 values)

1. Go to [ads.google.com](https://ads.google.com)
2. Click **Tools & Settings** (wrench icon) → **API Center**
3. Copy your **Developer Token**
4. Note your **Login Customer ID** — this is your MCC (Manager) account ID, the 10-digit number at the top of the page (format: `123-456-7890`)

> **Don't have API access?** You'll need to [apply for a developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). Basic access is usually approved within a few days.

### From Google Cloud Console (2 values)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or select an existing one)
3. Go to **APIs & Services** → **Library** → search for "Google Ads API" → **Enable** it
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Choose **Web application** as the application type
6. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI
7. Copy your **Client ID** and **Client Secret**

### From OAuth Playground (1 value)

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)
2. Click the **gear icon** (top right) → check **Use your own OAuth credentials**
3. Paste your **Client ID** and **Client Secret** from the previous step
4. In the left panel, find **Google Ads API v22** → select `https://www.googleapis.com/auth/adwords`
5. Click **Authorize APIs** → sign in with the Google account that has access to your Google Ads
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh Token**

### Enter your credentials

```bash
gemini extensions config google-ads-agent
```

It will prompt for each value. Sensitive fields (developer token, client secret, refresh token) are stored in your system keychain — not in plain text.

---

## Commands

Three slash commands for structured analysis:

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
Activates automatically when you ask about campaigns, budgets, keywords, ads, PPC, ROAS, bidding, or Performance Max. Includes:
- GAQL query templates for common reports
- Cost formatting (Google uses micros — the skill converts to dollars)
- Anomaly detection thresholds (CPA spikes >20%, zero conversions, budget limits)
- Write safety protocol: Confirm → Execute → Post-check

### Security Auditor
Activates when you ask to audit security, scan for secrets, or check for vulnerabilities. Includes:
- 10+ secret patterns (sk-, AIzaSy, ghp_, AKIA, xox, whsec_, etc.)
- Auth/authz, input validation, error handling, encryption checks
- Severity framework (Critical / High / Medium / Low)

---

## Extension Structure

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

## Update

```bash
gemini extensions update google-ads-agent
```

## Uninstall

```bash
gemini extensions uninstall google-ads-agent
```

## Local Development

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

Changes auto-reload — no need to reinstall.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `command not found: gemini` | Run `npm install -g @google/gemini-cli` |
| `Please set an Auth method` | Create `~/.gemini/.env` with `GEMINI_API_KEY=your-key` ([get one free](https://aistudio.google.com/apikey)) |
| `Missing Google Ads credentials` | Run `gemini extensions config google-ads-agent` |
| `Authentication failed` | Your refresh token may have expired — regenerate it in [OAuth Playground](https://developers.google.com/oauthplayground/) |
| `Permission denied` | Make sure the account is accessible under your MCC |
| `Rate limit exceeded` | Wait 60 seconds — the extension limits to 10 calls/min per tool |

## Related

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — Anthropic Agent Skills for Claude (analysis, audit, write, math, MCP)
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — Python MCP server with 29 tools
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Full Python agent with 28 API actions and 6 sub-agents
- [googleadsagent.ai](https://googleadsagent.ai) — Live production system (Buddy) on Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## License

MIT
