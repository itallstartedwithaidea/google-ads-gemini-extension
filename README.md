# Google Ads Agent — Gemini CLI Extension

A [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension that gives you **live Google Ads API access** from your terminal. Ask questions about your campaigns, find wasted spend, audit accounts, get optimization recommendations — all through natural conversation.

Built from production learnings running an AI Google Ads agent at [ahmeego.com](https://ahmeego.com) — 28 custom API actions, 6 sub-agents, managing real Google Ads accounts via the Google Ads API v22.

---

## TL;DR — The Two Commands That Solve Most Problems

If you've already installed everything and something stops working, **try these in order before anything else:**

```text
/quit                                # in the Gemini CLI
gemini                               # restart the whole process (NOT just /clear)
/google-ads:logout
/google-ads:login                    # browser opens, pick your Google account, approve
list my Google Ads accounts          # ask in plain English; should return your accounts
```

Why these specifically? Because **the MCP server reads `GADS_SITE_URL` and your `.env` exactly once at process startup.** If you edit `.env` while Gemini is running, those changes don't take effect until you `/quit` and re-launch. This single behavior caused ~80% of "0 accounts available" / "session expired" reports we've seen. See [Common Gotchas](#common-gotchas) before you debug anything else.

---

## First-Time Setup — Click by Click

Use this if you've never set anything up. Each step is one literal action.

### Step 0 — Decide your auth lane

**Don't pick yet — read both, then come back.** Most people end up doing **Method 2 first** and adding Method 1 later (or never).

| | Method 1 — Local API (`.env` + `google-ads.yaml`) | Method 2 — Browser sign-in (`/google-ads:login`) |
|---|---|---|
| Setup time | ~10 min, requires Cloud Console | ~30 sec, click button in browser |
| What you need | Developer token, Client ID/Secret, Refresh token, MCC ID | Just a Google account with Google Ads access |
| Who it's for | Power users, CI/CD, fixed machine identity | Everyone else (recommended) |
| When it breaks | `invalid_grant` after 6 months / password change | Almost never |
| Fix when broken | Re-run `scripts/refresh-local-token.py` | Re-run `/google-ads:login` |

**If unsure, do Method 2 only. Skip to Step 4.**

### Step 1 — Install Node.js (if you don't have it)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### Step 2 — Install Gemini CLI

```bash
npm install -g @google/gemini-cli
```

Verify with `gemini --version`. If you get `command not found`, your global npm bin isn't on `$PATH` — see [Troubleshooting](#troubleshooting).

### Step 3 — Get a Gemini API key (free)

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **Create API key** (blue button, top right)
3. Click **Create API key in new project** if it asks
4. Click the **copy** icon next to the key
5. Save it:

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=PASTE_KEY_HERE' > ~/.gemini/.env
```

Free tier: 60 requests/min, 1,000/day. You won't hit it.

### Step 4 — Install this extension

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

You'll see `Successfully installed extension google-ads-agent`. The extension now auto-loads every time you launch Gemini.

### Step 5 — Sign in (Method 2, recommended)

```bash
gemini
```

Wait for the welcome banner. Then **type these two commands one at a time** (press Enter between them):

```text
/google-ads:logout
/google-ads:login
```

What you'll see, in order:

1. **Browser opens** to a Google sign-in page (`accounts.google.com/...`)
2. **Pick a Google account** that has Google Ads access (or click "Use another account")
3. **Click "Continue"** on the AHMEEGO consent screen
4. **Click "Allow"** on the Google Ads permission scope
5. Browser shows **"You can close this tab"** — close it
6. Back in Gemini you'll see `✅ Signed in as you@example.com`

An opaque session ID is stored in your **OS keychain** (macOS Keychain / Windows Credential Manager / Linux libsecret) via [keytar](https://github.com/atom/node-keytar). If keychain isn't available, the extension falls back to a `0600`-permission file that's gitignored. **The Google refresh token never leaves ahmeego.com** — it stays encrypted at-rest on the site and the CLI only ever sees the session handle.

### Step 6 — Verify it works

In the same Gemini session, type:

```text
list my Google Ads accounts
```

You should see a table of your accounts. If you see **0 accounts** but you know you have access, it's almost always a stale env var — see [Common Gotchas](#common-gotchas) #1 below.

---

## Common Gotchas

These are the issues that cost real users (and us) the most time. **Read this section before opening an issue.**

### 1. "0 accounts available" right after a successful login

**Symptom:** `/google-ads:login` succeeds, browser shows "Success", but `list_accounts` returns 0 — even though you know the Google account has access (you can see the accounts at [ads.google.com](https://ads.google.com)).

**Cause:** The MCP server captured `GADS_SITE_URL` (and other env vars) at process startup. If you edited `~/.gemini/extensions/google-ads-agent/.env` after Gemini was already running, the server is still pointed at the old value. The login itself works because the browser follows redirects, but the session lookup goes to the wrong host afterward.

**Fix — and this is the universal "did you turn it off and on again" for this extension:**

```text
/quit                                    # in the Gemini CLI
gemini                                   # NEW process, not /clear
/google-ads:logout
/google-ads:login
```

`/clear` is **not** enough. `/restart` is **not** enough. You need a full Node process restart so it re-reads the `.env`.

### 2. `redirect_uri_mismatch` when running the local-token script

**Symptom:** You run `python scripts/refresh-local-token.py`, the browser opens, you sign in, and Google shows:

> Access blocked: This app's request is invalid  
> Error 400: redirect_uri_mismatch

**Cause:** Your OAuth client (in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)) doesn't have `http://localhost:8081/` in its **Authorized redirect URIs** list. "Web application" OAuth clients require an exact match — no wildcards, no implicit ports.

> **Important:** *JavaScript Origins* and *Redirect URIs* are different lists in Cloud Console. The script needs the entry in **Authorized redirect URIs**, not Authorized JavaScript origins.

**Fix:**

1. Open [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID (the one whose `client_id` is in `google-ads.yaml`)
3. Under **Authorized redirect URIs** click **+ Add URI**
4. Paste exactly: `http://localhost:8081/` (include the trailing slash)
5. Click **Save**
6. Re-run `python scripts/refresh-local-token.py`

If you'd rather use a different port, change `LOCAL_REDIRECT_PORT` at the top of the script to match a port you already have registered.

### 3. `invalid_grant` from the local API lane

**Symptom:** `connection_status` says Method 1 is "active" or "Connected", but `list_accounts` or any GAQL query fails with `Error: invalid_grant`. The "Connected" reading is misleading — it just checks "are the four required env vars set?", not "does the token actually work?".

**Cause:** Your Method 1 refresh token is expired or revoked. Refresh tokens get killed by:
- 6 months of inactivity
- Password change on the Google account that issued them
- Manual revocation at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
- Issuing >50 refresh tokens for the same client (Google evicts the oldest)

**Important — the MCP server reads `process.env.GOOGLE_ADS_REFRESH_TOKEN`, not `google-ads.yaml`.** Your refresh token lives in two places that need to be kept in sync:

| Where | Used by |
|---|---|
| `google-ads.yaml` | Python projects that call `GoogleAdsClient.load_from_storage()` (Buddy, google-ads-python, etc.) |
| OS keychain (set by `gemini extensions config google-ads-agent`) **and/or** `~/.gemini/extensions/google-ads-agent/.env` | This Gemini extension's MCP server. `.env` overrides the keychain. |

If you only update `google-ads.yaml`, your Python tooling works but **the Gemini extension keeps using the stale keychain entry and stays broken.**

**Fix — generate a new refresh token, then propagate it to BOTH places:**

```bash
cd /path/to/your/google-ads.yaml/parent-dir
pip install google-auth-oauthlib pyyaml
python /path/to/google-ads-gemini-extension/scripts/refresh-local-token.py
```

`refresh-local-token.py` (v2.4.4+) does both steps automatically:
1. Runs the OAuth flow on `http://localhost:8081/`, captures the new refresh token, writes it into `google-ads.yaml`.
2. **Also writes `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CLIENT_SECRET`, and `GOOGLE_ADS_DEVELOPER_TOKEN` into `~/.gemini/extensions/google-ads-agent/.env`** so the extension picks up the new value on next startup. `.env` overrides the keychain.

If your extension lives somewhere non-standard, set `GADS_EXT_ENV=/abs/path/to/.env` before running the script. If you'd rather not let the script touch your `.env`, run `gemini extensions config google-ads-agent` instead and paste the new refresh token from `google-ads.yaml` line 8 manually.

**After running the script, `/quit` and re-launch Gemini** so the MCP server re-reads `.env`. (This is the same restart rule as Common Gotcha #1.)

### 4. "Sign-in timed out after 120s" but the browser said "Success"

**Symptom:** You completed the sign-in flow, the browser confirmed success, but Gemini says it timed out.

**Cause:** The poll handle in your terminal already reached its 120-second deadline before the browser callback completed (slow Google consent step, network blip, or you walked away mid-flow). The session itself is valid — Gemini just stopped waiting for it.

**Fix:** Just type `/google-ads:login` again. Because the session is already minted on the server, the second attempt picks it up almost instantly.

### 5. "0 leaf accounts found" on an MCC

**Symptom:** `list_sub_accounts` on your MCC returns "Leaf accounts: 0 found", even though there are clearly accounts under it in the Google Ads UI.

**Cause:** This usually means one of:
- The signed-in Google account has access to the MCC but not its sub-accounts (rare but possible — check Tools & Settings → Access & Security on each sub-account)
- The MCC is deeply nested and you're querying a leaf-MCC level that doesn't expose its grandchildren
- A stale env (see Gotcha #1 — try the restart first)

**Fix:** First do the full restart from #1. If that doesn't help, run `list_accounts` (without the customer_id filter) to see everything your identity can reach, then query specific Customer IDs directly.

---

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
| **Auth** | Dual-lane: static `.env` API credentials **and** zero-setup browser OAuth via ahmeego.com for any Google account, switchable at runtime, opaque session stored in the OS keychain |
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
| `remote_login` | Opens the browser at ahmeego.com's hosted OAuth flow, receives an opaque session, stores the identity (session ID in OS keychain), sets it active. No Cloud Console, no client IDs, no refresh tokens in the CLI. Works with any Google account that has Google Ads access. |
| `remote_switch` | Switch the active identity to a previously signed-in email. No browser, no re-auth — reuses the opaque session stored in your keychain. |
| `remote_status` | Shows both lanes side-by-side. Method 1 credential check (lists any missing env vars); Method 2 stored identities with active pointer, account counts, storage backend (keychain vs file). Never prints tokens. |
| `remote_logout` | Invalidates the opaque session at ahmeego.com, deletes the keychain entry, removes the identity from `sessions.json`. For legacy v2.3 identities that still carry a refresh token, also revokes at Google. Defaults to the active identity if no email is given. |


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

- **Hosted OAuth** (v2.4+): the CLI never sees your Google refresh token. ahmeego.com holds a verified OAuth client, does the consent dance, and hands back an opaque session ID only. No Cloud Console project, no client IDs, no `redirect_uri_mismatch` errors.
- **CSRF-protected handle**: every sign-in uses a per-attempt random `device_id` and a short-lived KV state with a `state` parameter verified on callback. The poll handle self-destructs on first read.
- **Secrets never in plaintext files by default**: the opaque session ID lives in the OS keychain; only when keychain is unavailable does the extension fall back to a `0600`-permission file that's gitignored.
- **Revocation on logout**: `/google-ads:logout` invalidates the session server-side at ahmeego.com so it can't be reused. Legacy v2.3 identities that still carry a refresh token are also revoked at Google.
- **Read-only by default**: `run_gaql` only allows SELECT queries — CREATE, UPDATE, DELETE, MUTATE, and REMOVE are all blocked.
- **Policy engine**: every API tool requires your confirmation before it runs.
- **Rate limiting**: 10 calls per minute per tool to prevent runaway usage.
- **Error sanitization**: internal API details are never exposed — you get clean, actionable error messages.
- **Audit logging**: every tool call is logged to `~/.gemini/logs/google-ads-agent.log`.
- **Lane isolation**: Method 1's static API credentials and Method 2's opaque session are fully independent. Signing in or out of Method 2 never affects Method 1's `.env` credentials.

---

## Getting Credentials (Method 1 only)

> **You probably don't need this.** If you ran `/google-ads:login` (Method 2) and `list_accounts` shows your accounts, you're done — close this section. This is only for users who want a **fixed machine identity** for CI/CD, scripting, or because they prefer the static API lane. Both methods can run side-by-side.

> **Upgrading from v2.2?** Your existing `GADS_SITE_SESSION_ID` in `.env` is still honored as a fallback when no identity is stored, so nothing breaks. Run `/google-ads:login` once to migrate to the keychain — afterwards you can delete `GADS_SITE_SESSION_ID` entirely.

You'll collect **5 values** from **2 places**, then a one-shot script handles the rest.

### Step A — From Google Ads (2 values)

1. Open [ads.google.com](https://ads.google.com)
2. Click **Tools & Settings** (wrench icon, top-right) → under "Setup" → **API Center**
3. Copy the **Developer token** (looks like 22 alphanumeric chars)
4. Note your **Manager (MCC) account ID** — the 10-digit number at the top of the page (format `123-456-7890`). Strip the dashes when you save it.

> **No API access yet?** [Apply for a developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). Basic access is usually approved within 1–3 business days.

### Step B — From Google Cloud Console (2 values + 1 critical setting)

1. Open [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Top bar → pick or create a project → click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. **Application type:** select **Web application**
4. **Name:** anything memorable, e.g. `gemini-cli-google-ads`
5. Under **Authorized redirect URIs** click **+ ADD URI** and add **both**:
   - `http://localhost:8081/`  ← required by `refresh-local-token.py`, must include trailing slash
   - `https://developers.google.com/oauthplayground`  ← optional fallback if the script ever fails
6. Click **CREATE**
7. Copy the **Client ID** and **Client Secret** from the modal that appears

If you skip the `localhost:8081/` step you'll hit Common Gotcha #2 (`redirect_uri_mismatch`).

### Step C — Generate the refresh token (1 value, automated)

Save your 4 values into a `google-ads.yaml` file in any directory:

```yaml
developer_token: PASTE_FROM_STEP_A
client_id: PASTE_FROM_STEP_B
client_secret: PASTE_FROM_STEP_B
login_customer_id: '1234567890'   # your MCC, no dashes, quoted as a string
use_proto_plus: True
# refresh_token: filled in by the script in the next step
```

Then run the helper script (one-time `pip install`, then a single command):

```bash
cd /path/to/where/google-ads.yaml/lives
pip install google-auth-oauthlib pyyaml
python /path/to/google-ads-gemini-extension/scripts/refresh-local-token.py
```

The script:
1. Reads `client_id` and `client_secret` from your `google-ads.yaml`
2. Spins up a local listener on `http://localhost:8081/`
3. Opens your browser to Google's consent screen
4. Receives the auth code on the loopback callback
5. Exchanges it for a fresh `refresh_token`
6. Writes the token back into `google-ads.yaml` in place

You'll see `✓ Wrote new refresh_token to google-ads.yaml` when it's done. **No copy-pasting from OAuth Playground required.**

> **Prefer OAuth Playground anyway?** It still works as a fallback. Visit [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/) → gear icon → "Use your own OAuth credentials" → paste your client ID/secret → in the left panel pick **Google Ads API v22** → `https://www.googleapis.com/auth/adwords` → **Authorize APIs** → **Exchange authorization code for tokens** → copy the refresh token into `google-ads.yaml`.

### Step D — Point the extension at your credentials

```bash
gemini extensions config google-ads-agent
```

It will prompt for each value. Sensitive fields (developer token, client secret, refresh token) are stored in your OS keychain — not in plain text. Then `/quit` and re-launch Gemini so the MCP server picks up the new credentials.

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
├── scripts/
│   └── refresh-local-token.py  # One-shot Method 1 refresh-token regenerator
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

> **First, always:** if anything weird is happening, do `/quit` → `gemini` → `/google-ads:logout` → `/google-ads:login` before deeper debugging. See [Common Gotchas #1](#common-gotchas) for why.

| Problem | Solution |
|---------|----------|
| `command not found: gemini` | Run `npm install -g @google/gemini-cli`. If still failing, your global npm bin isn't on `$PATH` — run `npm prefix -g` and add `<that>/bin` to `$PATH` in your shell rc file. |
| `Please set an Auth method` | Create `~/.gemini/.env` with `GEMINI_API_KEY=your-key` ([get one free](https://aistudio.google.com/apikey)) |
| `0 accounts available` after a successful login | Stale env. `/quit`, re-run `gemini`, then `/google-ads:logout && /google-ads:login`. See [Common Gotchas #1](#common-gotchas). |
| `Site credentials unavailable — session may have expired` (right after a fresh login) | Same root cause as "0 accounts". Full process restart fixes it. |
| `Sign-in timed out after 120s` but the browser said "Success" | Just re-run `/google-ads:login`. The session is already minted server-side; the second attempt picks it up. |
| `redirect_uri_mismatch` from `refresh-local-token.py` | Add `http://localhost:8081/` (with trailing slash) to your OAuth client's **Authorized redirect URIs** at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials). See [Common Gotchas #2](#common-gotchas). |
| `Error: invalid_grant` from any GAQL or Method 1 tool | Refresh token expired/revoked. Run `python scripts/refresh-local-token.py` — it updates **both** `google-ads.yaml` (for Python tooling) **and** `~/.gemini/extensions/google-ads-agent/.env` (for the Gemini extension's MCP server). Then `/quit` + relaunch Gemini. See [Common Gotchas #3](#common-gotchas) for why both stores need updating. |
| Method 1 keeps showing `invalid_grant` even after running the refresh script | You're running an older copy of the script (pre-v2.4.4) that only writes to `google-ads.yaml` and not to the extension's `.env`. The OS keychain still has the stale token. Either upgrade the script (it's at `scripts/refresh-local-token.py` in this repo, v2.4.4+) or run `gemini extensions config google-ads-agent` and paste the new refresh token from `google-ads.yaml` manually. |
| `Missing Google Ads credentials` | Run `gemini extensions config google-ads-agent` |
| `Permission denied` | Make sure the signed-in account has at least Read access in Google Ads → **Tools & Settings** → **Access & Security**. |
| `Rate limit exceeded` | Wait 60 seconds — the extension limits to 10 calls/min per tool. |
| Anything else weird | Tail the audit log: `tail -f ~/.gemini/logs/google-ads-agent.log`. Every tool call is logged there with arguments and outcome. |

## Related

- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Full Python agent with 28 API actions and 6 sub-agents
- [ahmeego.com](https://ahmeego.com) — Live production system (Buddy) on Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## License

MIT
