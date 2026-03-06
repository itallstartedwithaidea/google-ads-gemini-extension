# Google Ads Agent Extension

You have live Google Ads API access and expert PPC knowledge through this extension.

## MCP Tools Available

These tools connect directly to the Google Ads API:

| Tool | What it does |
|------|-------------|
| `list_accounts` | List all accessible accounts under the MCC |
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
| `run_gaql` | Custom GAQL queries (read-only — writes blocked) |
| `account_health` | Quick health check with automatic anomaly detection |

## Commands

- `/google-ads:analyze` — Analyze campaign or account performance
- `/google-ads:audit` — Comprehensive 7-dimension account audit
- `/google-ads:optimize` — Prioritized optimization recommendations

## Key Rules

1. **Write safety**: `run_gaql` only allows SELECT queries. Never attempt to bypass this.
2. **Cost formatting**: API returns micros — always divide by 1,000,000 for dollars.
3. **Confirm before acting**: All API tools require user confirmation via the policy engine.
4. **Anomaly flags**: Flag CPA spikes >20%, zero-conversion spend, CTR drops >15%, QS < 5.
5. **Tables**: Present data in markdown tables.
6. **Rate limits**: 10 calls/min per tool. Google Ads API: Basic = 15K ops/day, Standard = unlimited.

## API Reference

- Google Ads API Version: v22
- Query Language: GAQL
- Authentication: OAuth 2.0 with refresh tokens
