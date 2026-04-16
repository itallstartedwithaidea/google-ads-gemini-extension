# Google Ads Agent — Gemini CLI Extension

A [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension that gives you **live Google Ads API access** from your terminal. Ask questions about your campaigns, find wasted spend, audit accounts, get optimization recommendations — all through natural conversation.

Built from production learnings running an AI Google Ads agent at [googleadsagent.ai](https://googleadsagent.ai) — 28 custom API actions, 6 sub-agents, managing real Google Ads accounts via the Google Ads API v22.

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

### Step 5: Sign in (30 seconds, any Google account)

As of v2.3, signing in is one command — the extension opens your browser, you pick any Google account with Google Ads access, and you're done. No copy-pasting session IDs, no OAuth Playground, no manual `.env` editing.

```bash
gemini
```

Then in the CLI:

```
> /google-ads:login
```

What happens:

1. Your default browser opens to Google's consent screen
2. Pick any Google account that has Google Ads access
3. Approve the one scope (`adwords`)
4. The tab auto-closes — you're back in the terminal
5. The extension prints `✅ Signed in as you@example.com — 123 accounts accessible`

An opaque session ID is stored in your **OS keychain** (macOS Keychain / Windows Credential Manager / Linux libsecret) via [keytar](https://github.com/atom/node-keytar). If keychain isn't available, the extension falls back to a `0600`-permission file that's gitignored. **The Google refresh token never leaves googleadsagent.ai** — it stays encrypted at-rest on the site and the CLI only ever sees the session handle.

**Two independent lanes, both active at once:**

| Lane | What it is | How to configure |
|------|------------|------------------|
| **Method 1 — Local API** | Your static Google Ads API credentials in `.env`. One fixed identity. | `gemini extensions config google-ads-agent` (see [Getting Credentials](#getting-credentials)) |
| **Method 2 — Remote (browser sign-in)** | Whatever Google email you just signed in with. Switchable at any time. | `/google-ads:login` |

You can have both, either, or neither. `list_accounts` automatically merges results from both lanes with deduplication.

**Multi-identity:** run `/google-ads:login` again with a different Google account to add another identity. Switch between them with zero re-auth:

```
> /google-ads:status                  # see all stored identities
> /google-ads:switch other@example.com  # hop to another, no browser
> /google-ads:logout                  # revoke at Google and clear locally
```

### Step 6: Start using it

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
/google-ads:login                             # sign in with any Google account
/google-ads:status                            # show Method 1 + Method 2 auth state
/google-ads:switch other@example.com          # hop to another stored identity
/google-ads:logout                            # revoke + clear the active identity
/google-ads:analyze "Brand Search last 30 days"
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
| **MCP Server** | 26 tools — 15 read + 7 write + 4 auth, with live Google Ads API access |
| **Commands** | `/google-ads:login`, `/google-ads:switch`, `/google-ads:status`, `/google-ads:logout`, `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Auth** | Dual-lane: static `.env` API credentials **and** zero-setup browser OAuth via googleadsagent.ai for any Google account, switchable at runtime, opaque session stored in the OS keychain |
| **Skills** | `google-ads-agent` (PPC expertise + GAQL templates) and `security-auditor` (vulnerability scanning) |
| **Context** | `GEMINI.md` — persistent API reference loaded every session |
| **Hooks** | GAQL write-blocking + audit logging for every tool call |
| **Policies** | User confirmation required before any API call executes |
| **Themes** | `google-ads` (dark) and `google-ads-light` (light) |
| **Settings** | 7 settings — Method 1 API credentials (keychain) + Remote site URL/session |

---

## MCP Server — 26 Tools

### Auth Tools (4, new in v2.3)

These manage the Remote (browser-sign-in) lane. They never touch Method 1.

| Tool | Description |
|------|-------------|
| `remote_login` | Opens the browser at googleadsagent.ai's hosted OAuth flow, receives an opaque session, stores the identity (session ID in OS keychain), sets it active. No Cloud Console, no client IDs, no refresh tokens in the CLI. Works with any Google account that has Google Ads access. |
| `remote_switch` | Switch the active identity to a previously signed-in email. No browser, no re-auth — reuses the opaque session stored in your keychain. |
| `remote_status` | Shows both lanes side-by-side. Method 1 credential check (lists any missing env vars); Method 2 stored identities with active pointer, account counts, storage backend (keychain vs file). Never prints tokens. |
| `remote_logout` | Invalidates the opaque session at googleadsagent.ai, deletes the keychain entry, removes the identity from `sessions.json`. For legacy v2.3 identities that still carry a refresh token, also revokes at Google. Defaults to the active identity if no email is given. |


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

- **Hosted OAuth** (v2.4+): the CLI never sees your Google refresh token. googleadsagent.ai holds a verified OAuth client, does the consent dance, and hands back an opaque session ID only. No Cloud Console project, no client IDs, no `redirect_uri_mismatch` errors.
- **CSRF-protected handle**: every sign-in uses a per-attempt random `device_id` and a short-lived KV state with a `state` parameter verified on callback. The poll handle self-destructs on first read.
- **Secrets never in plaintext files by default**: the opaque session ID lives in the OS keychain; only when keychain is unavailable does the extension fall back to a `0600`-permission file that's gitignored.
- **Revocation on logout**: `/google-ads:logout` invalidates the session server-side at googleadsagent.ai so it can't be reused. Legacy v2.3 identities that still carry a refresh token are also revoked at Google.
- **Read-only by default**: `run_gaql` only allows SELECT queries — CREATE, UPDATE, DELETE, MUTATE, and REMOVE are all blocked.
- **Policy engine**: every API tool requires your confirmation before it runs.
- **Rate limiting**: 10 calls per minute per tool to prevent runaway usage.
- **Error sanitization**: internal API details are never exposed — you get clean, actionable error messages.
- **Audit logging**: every tool call is logged to `~/.gemini/logs/google-ads-agent.log`.
- **Lane isolation**: Method 1's static API credentials and Method 2's opaque session are fully independent. Signing in or out of Method 2 never affects Method 1's `.env` credentials.

---

## Getting Credentials

> **Do you actually need this?** If you just want to read and edit accounts that your Google login can see, you don't — run `/google-ads:login` and you're done. This section covers **Method 1** (the static API lane) which you only need if you want a fixed machine identity independent of whatever browser account you're signed in with. Many users run **both**.

> **Upgrading from v2.2?** Your existing `GADS_SITE_SESSION_ID` in `.env` is still honored as a fallback when no identity is stored, so nothing breaks. Run `/google-ads:login` once to migrate to the new identity store — afterwards you can delete `GADS_SITE_SESSION_ID` from `.env` entirely.

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

- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Full Python agent with 28 API actions and 6 sub-agents
- [googleadsagent.ai](https://googleadsagent.ai) — Live production system (Buddy) on Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## License

MIT
