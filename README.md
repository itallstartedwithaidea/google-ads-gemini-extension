# Google Ads Agent — Gemini CLI Extension

A [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension that adds Google Ads management skills, commands, and expert context — campaign analysis, auditing, optimization, and security auditing.

Built from production learnings running an AI Google Ads agent at [googleadsagent.ai](https://googleadsagent.ai) — a system with 28 custom API actions and 6 sub-agents managing live Google Ads accounts via the Google Ads API v22.

## Install

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

During installation, you'll be prompted for your Google Ads API credentials (stored securely in your system keychain). If you don't have them yet, skip for now — the skills and commands still work as advisory tools without live API access.

## What's Included

### Commands

| Command | What it does |
|---------|-------------|
| `/google-ads:analyze` | Analyze campaign or account performance — anomaly detection, trend identification, spend analysis |
| `/google-ads:audit` | Comprehensive 7-dimension account audit with severity ratings |
| `/google-ads:optimize` | Prioritized optimization recommendations ranked by effort vs. impact |

### Skills

| Skill | Activates when |
|-------|---------------|
| **google-ads-agent** | User asks about campaigns, budgets, keywords, ads, PPC, ROAS, bidding, Performance Max |
| **security-auditor** | User asks to audit security, scan for secrets, check for vulnerabilities |

### Context (GEMINI.md)

Persistent context loaded every session with:
- Google Ads API v22 reference (GAQL, micros formatting, rate limits)
- Available commands and skills summary
- Write safety protocol (always confirm before mutations)

## Usage Examples

```
# Analyze a specific campaign
/google-ads:analyze "Brand Search campaign for Acme Corp, last 30 days"

# Run a full account audit
/google-ads:audit "Acme Corp Google Ads account, focus on wasted spend"

# Get optimization recommendations
/google-ads:optimize "Improve ROAS for our ecommerce campaigns"

# The skills activate automatically in conversation
> "What GAQL query would show me my top keywords by conversion rate?"
> "Audit this codebase for security vulnerabilities"
```

## Extension Structure

```
google-ads-gemini-extension/
├── gemini-extension.json       # Manifest with settings for API credentials
├── GEMINI.md                   # Persistent context (loaded every session)
├── commands/
│   └── google-ads/
│       ├── analyze.toml        # /google-ads:analyze
│       ├── audit.toml          # /google-ads:audit
│       └── optimize.toml       # /google-ads:optimize
├── skills/
│   ├── google-ads-agent/
│   │   └── SKILL.md            # PPC management expertise + GAQL patterns
│   └── security-auditor/
│       └── SKILL.md            # Security vulnerability scanning
└── README.md
```

## Google Ads Agent Skill Highlights

- **6 GAQL query templates**: campaign performance, search terms, keyword quality, ad performance, PMax asset groups, geographic
- **Cost formatting**: automatic micros → dollars conversion guidance
- **Anomaly thresholds**: CPA spike >20%, CTR drop >15%, zero-conversion spend, quality score < 5, budget depletion
- **Write safety (CEP)**: Confirm → Execute → Post-check for any mutation
- **Rate limit awareness**: Basic = 15K ops/day, Standard = unlimited

## Security Auditor Skill Highlights

- **Secret pattern detection**: 10+ patterns (sk-, AIzaSy, ghp_, AKIA, xox, whsec_, etc.)
- **Auth/authz checks**: session management, OAuth flows, privilege escalation
- **Input validation**: SQL/GAQL injection, path traversal, CORS, XSS, SSRF
- **Severity framework**: Critical / High / Medium / Low with structured report format

## Settings

During installation, the extension prompts for these optional credentials:

| Setting | Environment Variable | Sensitive |
|---------|---------------------|-----------|
| Google Ads Developer Token | `GOOGLE_ADS_DEVELOPER_TOKEN` | Yes |
| Google Ads Client ID | `GOOGLE_ADS_CLIENT_ID` | No |
| Google Ads Client Secret | `GOOGLE_ADS_CLIENT_SECRET` | Yes |
| Google Ads Refresh Token | `GOOGLE_ADS_REFRESH_TOKEN` | Yes |
| Google Ads Login Customer ID | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | No |

These are optional. Without them, the extension still provides expert advisory skills and commands — you just won't have live API access.

## Update

```bash
gemini extensions update google-ads-agent
```

## Related

- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Full Python agent with 28 API actions and 6 sub-agents
- [googleadsagent.ai](https://googleadsagent.ai) — Live production system (Buddy) on Cloudflare
- [Gemini CLI Extensions Docs](https://geminicli.com/docs/extensions/writing-extensions/)

## License

MIT
