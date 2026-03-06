# Google Ads Agent — Gemini CLI Extension

A full-featured [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension that adds **live Google Ads API access** through an MCP server, plus expert skills, commands, hooks, policies, and themes.

Built from production learnings running an AI Google Ads agent at [googleadsagent.ai](https://googleadsagent.ai) — 28 custom API actions, 6 sub-agents, managing real Google Ads accounts via the Google Ads API v22.

## Install

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

You'll be prompted for your Google Ads API credentials (stored securely in your system keychain). See [Getting Credentials](#getting-credentials) below.

## Features

This extension implements every feature type in the Gemini CLI extension spec:

| Feature | What's included |
|---------|----------------|
| **MCP Server** | 9 tools with live Google Ads API access (campaigns, keywords, search terms, budgets, ads, geo, custom GAQL) |
| **Commands** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent` (PPC expertise + 6 GAQL templates) and `security-auditor` (vulnerability scanning) |
| **Context** | `GEMINI.md` — persistent API reference, tool inventory, and key rules |
| **Hooks** | GAQL write protection + API call audit logging |
| **Policies** | User confirmation required before API calls |
| **Themes** | `google-ads` (dark) and `google-ads-light` — Google's design language |
| **Settings** | 5 credential fields with keychain storage for sensitive values |

## MCP Server Tools

These tools let Gemini directly query your Google Ads accounts:

| Tool | Description |
|------|-------------|
| `list_accounts` | List all accounts under your MCC |
| `campaign_performance` | Campaign metrics with spend, conversions, CTR, CPC, CPA |
| `search_terms_report` | Search terms analysis with wasted spend detection |
| `keyword_quality` | Quality scores with component breakdowns |
| `ad_performance` | Ad creative performance and RSA strength scores |
| `budget_analysis` | Budget allocation, efficiency, and limited campaign detection |
| `geo_performance` | Geographic performance by location |
| `run_gaql` | Custom GAQL queries (read-only — writes blocked by safety) |
| `account_health` | Quick health check with automatic anomaly detection |

### Safety

- **Read-only by default**: The `run_gaql` tool blocks all write operations (CREATE, UPDATE, DELETE, MUTATE, REMOVE)
- **Policy engine**: All API-calling tools require user confirmation before execution
- **Audit logging**: Every tool call is logged to `~/.gemini/logs/google-ads-agent.log`

## Commands

```bash
# Analyze a campaign
/google-ads:analyze "Brand Search campaign last 30 days"

# Run a full account audit
/google-ads:audit "Acme Corp, focus on wasted spend and quality scores"

# Get optimization recommendations
/google-ads:optimize "Improve ROAS for ecommerce campaigns"
```

## Skills

### Google Ads Agent
Activates when you ask about campaigns, budgets, keywords, ads, PPC, ROAS, bidding, or Performance Max. Includes:
- 6 GAQL query templates (campaigns, search terms, keywords, ads, PMax, geo)
- Cost formatting rules (micros → dollars)
- Anomaly detection thresholds
- Write safety protocol (CEP: Confirm → Execute → Post-check)

### Security Auditor
Activates when you ask to audit security, scan for secrets, or check for vulnerabilities. Includes:
- 10+ secret patterns (sk-, AIzaSy, ghp_, AKIA, xox, etc.)
- Auth/authz, input validation, error handling, encryption checks
- Severity framework (Critical/High/Medium/Low)

## Themes

Switch with `/theme`:
- **google-ads** — dark theme with Google's color palette
- **google-ads-light** — light theme matching Google Ads UI

## Extension Structure

```
google-ads-gemini-extension/
├── gemini-extension.json       # Manifest — MCP server, settings, themes
├── GEMINI.md                   # Persistent context (loaded every session)
├── package.json                # Node.js dependencies
├── server.js                   # MCP server — 9 Google Ads API tools
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
│   ├── hooks.json              # Hook definitions
│   └── log-tool-call.js        # Audit trail logger
├── policies/
│   └── safety.toml             # User confirmation rules
├── LICENSE
└── README.md
```

## Getting Credentials

You need 5 values from 2 places:

### From Google Ads (1 value)
1. Go to [Google Ads](https://ads.google.com) → Tools & Settings → API Center
2. Copy your **Developer Token** and **Login Customer ID** (MCC account ID)

### From Google Cloud Console (3 values)
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Google Ads API**
3. Create OAuth2 credentials (Web application type)
4. Copy **Client ID** and **Client Secret**

### Generate Refresh Token (1 value)
1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Settings → Use your own OAuth credentials → enter Client ID + Secret
3. Authorize `https://www.googleapis.com/auth/adwords`
4. Exchange for tokens → copy **Refresh Token**

### Configure the extension
```bash
gemini extensions config google-ads-agent
```

Or re-install to be prompted again.

## Update

```bash
gemini extensions update google-ads-agent
```

## Local Development

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

## Related

- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Full Python agent with 28 API actions and 6 sub-agents
- [googleadsagent.ai](https://googleadsagent.ai) — Live production system (Buddy) on Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## License

MIT
