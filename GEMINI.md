# Google Ads Agent Extension

You have live Google Ads API access and expert PPC knowledge through this extension.

Two lanes operate side-by-side:

- **Method 1 — Local Google Ads API**: direct SDK access using the static credentials in `.env` (developer token, client id/secret, refresh token, login customer id). Fastest path; covers accounts under the configured MCC.
- **Method 2 — Remote proxy via googleadsagent.ai (v2.4)**: any Google account with Google Ads access can sign in via `/google-ads:login` (browser-based, zero Cloud Console setup). Covers every account that identity can see on googleadsagent.ai.

Tools try Method 1 first and fall back to Method 2 automatically when an account isn't accessible locally.

## MCP Tools — Read & Analysis

| Tool | What it does |
|------|-------------|
| `connection_status` | Which backends are configured; also shows Remote account count |
| `list_accounts` | All accounts accessible via either lane (marked Local/Remote) |
| `campaign_performance` | Campaign metrics — spend, conversions, CTR, CPC, CPA |
| `search_terms_report` | Search terms with wasted spend analysis |
| `keyword_quality` | Quality scores with component breakdowns |
| `ad_performance` | Ad creative performance and strength scores |
| `budget_analysis` | Budget allocation, efficiency, limited campaigns |
| `geo_performance` | Geographic performance by location |
| `device_performance` | Performance by device (mobile/desktop/tablet) |
| `impression_share` | Impression share and lost opportunity (budget/rank) |
| `change_history` | Recent account changes — who, what, when |
| `list_recommendations` | Google's optimization recommendations with impact estimates |
| `compare_performance` | Period-over-period comparison with deltas |
| `calculate` | Ads math: budget projection, ROAS, CPA, forecast, IS opportunity |
| `run_gaql` | Custom GAQL queries (read-only — writes blocked; local only) |
| `account_health` | Quick health check with automatic anomaly detection |

## MCP Tools — Write (gated, confirmation required)

| Tool | What it does |
|------|-------------|
| `update_campaign_status` | Pause or enable a campaign |
| `update_ad_group_status` | Pause or enable an ad group |
| `update_keyword_bid` | Change a keyword's CPC bid |
| `update_campaign_budget` | Change a campaign's daily budget |
| `add_negative_keywords` | Add negatives at campaign or ad-group level |
| `add_rsa` | Create a responsive search ad |
| `apply_recommendation` | Apply a Google-suggested recommendation |

Write tools require local credentials and always surface the proposed change for confirmation before acting.

## MCP Tools — Auth (Method 2)

| Tool | What it does |
|------|-------------|
| `remote_login` | Sign in with any Google account via the googleadsagent.ai proxy flow |
| `remote_switch` | Switch active identity to a previously signed-in Google account |
| `remote_status` | Show both lanes + all stored identities (no secrets printed) |
| `remote_logout` | Remove a stored identity and best-effort delete the site-side session |

## Slash Commands

Read / analysis:
- `/google-ads:analyze` — analyze campaign or account performance
- `/google-ads:audit` — comprehensive 7-dimension account audit
- `/google-ads:optimize` — prioritized optimization recommendations

Auth:
- `/google-ads:login` — browser sign-in, any Google account (opens `googleadsagent.ai/api/auth/mobile-login?client=cli`)
- `/google-ads:switch <email>` — hop between stored identities, no re-auth
- `/google-ads:status` — show Method 1 + Method 2 side-by-side
- `/google-ads:logout [email]` — remove a stored identity

## Key Rules

1. **Write safety**: `run_gaql` only allows SELECT queries. Never attempt to bypass this.
2. **Cost formatting**: API returns micros — always divide by 1,000,000 for dollars.
3. **Confirm before acting**: every write tool surfaces the proposed change before executing.
4. **Anomaly flags**: flag CPA spikes >20%, zero-conversion spend, CTR drops >15%, QS < 5.
5. **Tables**: present data in markdown tables.
6. **Rate limits**: 10 calls/min per tool. Google Ads API Basic = 15K ops/day, Standard = unlimited.
7. **Never print secrets**: session ids, refresh tokens, and developer tokens must never appear in tool output. `remote_status` already redacts them.
8. **Prefer the auth tool for the user's intent**: if a user says "log in", call `remote_login` (don't run `connection_status` as a substitute). If they say "check status", call `remote_status` or `connection_status` — don't guess from prior context.

## API Reference

- Google Ads API Version: **v23** (google-ads-api SDK ^23.0.0)
- Query Language: GAQL
- Method 1 auth: OAuth 2.0 refresh token in `.env`
- Method 2 auth: opaque session id in OS keychain (or `sessions.secrets.json` fallback with 0600 perms); Google refresh tokens stay encrypted on googleadsagent.ai
