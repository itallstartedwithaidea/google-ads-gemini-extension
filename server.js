import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleAdsApi, enums, ResourceNames } from "google-ads-api";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as sessionStore from "./lib/session-store.js";
import { runLoginFlow, revokeRefreshToken } from "./lib/oauth-login.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(join(__dirname, ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (_) { /* .env optional */ }

const server = new McpServer({
  name: "google-ads-agent",
  version: "2.3.0",
});

// ─── Rate Limiter ────────────────────────────────────────────────────────────

const callHistory = new Map();
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

function checkRateLimit(toolName) {
  const now = Date.now();
  const history = callHistory.get(toolName) || [];
  const recent = history.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    throw new RateLimitError();
  }
  recent.push(now);
  callHistory.set(toolName, recent);
}

class RateLimitError extends Error {
  constructor() {
    super("Rate limit exceeded (10 calls/min). Wait a moment before retrying.");
  }
}

// ─── Error Sanitizer ─────────────────────────────────────────────────────────

function extractErrorMessage(e) {
  if (typeof e === "string") return e;
  if (e.message && typeof e.message === "string" && e.message !== "[object Object]") return e.message;
  if (e.errors && Array.isArray(e.errors)) {
    const msgs = e.errors.map((err) => {
      if (err.message) return err.message;
      if (err.errorCode) return JSON.stringify(err.errorCode);
      return String(err);
    });
    return msgs.join("; ");
  }
  if (e.details && typeof e.details === "object") {
    const nested = e.details.errors || e.details.details;
    if (Array.isArray(nested)) return extractErrorMessage({ errors: nested });
    if (e.details.message) return e.details.message;
  }
  if (e.error && typeof e.error === "string") return e.error;
  if (e.error && typeof e.error === "object") return extractErrorMessage(e.error);
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}") return s.slice(0, 300);
  } catch (_) {}
  return String(e);
}

function safeError(e) {
  if (e instanceof RateLimitError) return e.message;
  const msg = extractErrorMessage(e).toLowerCase();
  if (msg.includes("missing google ads credentials")) return extractErrorMessage(e);
  if (msg.includes("requested_metrics_for_manager"))
    return "This is a Manager (MCC) account — metrics can't be queried directly on MCCs. Use `list_sub_accounts` to find the leaf sub-accounts, then query those individual accounts instead.";
  if (msg.includes("unauthenticated") || msg.includes("authentication"))
    return "Authentication failed. Run: gemini extensions config google-ads-agent";
  if (msg.includes("permission_denied") || msg.includes("user_permission_denied"))
    return "Permission denied. Verify this account is accessible under your MCC.";
  if (msg.includes("resource_not_found"))
    return "Resource not found. Check the customer ID.";
  if (msg.includes("quota") || msg.includes("rate"))
    return "Google Ads API rate limit hit. Wait a few seconds and retry.";
  if (msg.includes("invalid_customer_id"))
    return "Invalid customer ID format. Use a 10-digit ID (e.g., 1234567890).";
  const readable = extractErrorMessage(e);
  console.error("[google-ads-agent]", readable);
  return `Error: ${readable.slice(0, 300)}. Check that your credentials and customer ID are correct.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUAL BACKEND — Local google-ads-api + Remote googleadsagent.ai
// ═══════════════════════════════════════════════════════════════════════════════

const SITE_URL = (process.env.GADS_SITE_URL || "").replace(/\/+$/, "");

// SITE_SESSION is loaded at boot from the session store (preferred) or
// from the legacy GADS_SITE_SESSION_ID env var (backward-compatible).
// It is mutated at runtime by remote_login / remote_switch / remote_logout
// so that the user can hot-swap identities without restarting the MCP server.
let SITE_SESSION = "";
let SITE_ACTIVE_EMAIL = null;
let SITE_CONFIGURED = false;

async function bootstrapRemoteSession() {
  try {
    const active = await sessionStore.getActive();
    if (active?.sessionId) {
      SITE_SESSION = active.sessionId;
      SITE_ACTIVE_EMAIL = active.email;
      SITE_CONFIGURED = !!SITE_URL;
      return;
    }
  } catch (_) { /* fall through to env */ }
  if (process.env.GADS_SITE_SESSION_ID) {
    SITE_SESSION = process.env.GADS_SITE_SESSION_ID;
    SITE_ACTIVE_EMAIL = null;
    SITE_CONFIGURED = !!(SITE_URL && SITE_SESSION);
  }
}
await bootstrapRemoteSession();

function setActiveSession({ sessionId, email }) {
  SITE_SESSION = sessionId || "";
  SITE_ACTIVE_EMAIL = email || null;
  SITE_CONFIGURED = !!(SITE_URL && SITE_SESSION);
  _siteCredsCache = null;
  _siteCredsCachedAt = 0;
  _siteAccountsCache = null;
  _siteAccountsCachedAt = 0;
  _autoRefreshAttempted = false;
}

let _siteCredsCache = null;
let _siteCredsCachedAt = 0;
const CREDS_TTL_MS = 50 * 60 * 1000;

let _siteAccountsCache = null;
let _siteAccountsCachedAt = 0;
const ACCOUNTS_TTL_MS = 10 * 60 * 1000;

let _autoRefreshAttempted = false;

function redactSecret(value, prefix = 8) {
  if (!value) return "<empty>";
  const s = String(value);
  if (s.length <= prefix + 2) return `<redacted len=${s.length}>`;
  return `${s.slice(0, prefix)}…(len=${s.length})`;
}

/**
 * Refresh the Remote session using the ACTIVE IDENTITY's own refresh token
 * (from the session store), not Method 1's GOOGLE_ADS_REFRESH_TOKEN. This
 * guarantees Method 1 and Method 2 stay cleanly separated: Method 1 is always
 * the static API creds, Method 2 is whatever email the user signed in with.
 */
async function autoRefreshSession() {
  if (_autoRefreshAttempted) return false;
  _autoRefreshAttempted = true;

  if (!SITE_URL) return false;

  let refreshToken = null;
  let email = SITE_ACTIVE_EMAIL;
  try {
    const active = await sessionStore.getActive();
    if (active?.refreshToken) {
      refreshToken = active.refreshToken;
      email = active.email;
    }
  } catch (_) { /* store unavailable */ }

  // Legacy fallback for users still on v2.2's env-var session without a
  // stored identity. Uses Method 1's refresh token only if no identity
  // is stored — this is the one exception, kept for backward compatibility.
  if (!refreshToken && !email && process.env.GOOGLE_ADS_REFRESH_TOKEN) {
    refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  }

  if (!refreshToken) return false;

  try {
    console.error(`[google-ads-agent] Remote session expired${email ? ` for ${email}` : ""} — refreshing...`);
    const resp = await fetch(`${SITE_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_api_session", refreshToken }),
    });
    const data = await resp.json();
    if (data.sessionId) {
      SITE_SESSION = data.sessionId;
      SITE_CONFIGURED = true;
      _siteCredsCache = null;
      _siteAccountsCache = null;
      _autoRefreshAttempted = false;
      if (email) {
        try { await sessionStore.updateSessionId(email, data.sessionId); } catch (_) {}
      }
      console.error(`[google-ads-agent] Auto-refresh OK: ${redactSecret(data.sessionId)} (${data.accounts} accounts)`);
      return true;
    }
    console.error(`[google-ads-agent] Auto-refresh failed: ${JSON.stringify(data)}`);
  } catch (e) {
    console.error(`[google-ads-agent] Auto-refresh error: ${e.message}`);
  }
  return false;
}

async function getSiteCreds() {
  if (_siteCredsCache && Date.now() - _siteCredsCachedAt < CREDS_TTL_MS) {
    return _siteCredsCache;
  }
  const resp = await fetch(`${SITE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get_creds", sessionId: SITE_SESSION }),
  });
  const data = await resp.json();
  if (data.error) {
    if (await autoRefreshSession()) return getSiteCreds();
    return null;
  }
  _siteCredsCache = data;
  _siteCredsCachedAt = Date.now();
  return data;
}

async function getSiteAccounts() {
  if (_siteAccountsCache && Date.now() - _siteAccountsCachedAt < ACCOUNTS_TTL_MS) {
    return _siteAccountsCache;
  }
  const resp = await fetch(`${SITE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accounts", sessionId: SITE_SESSION }),
  });
  const data = await resp.json();
  if (data.error && !data.accounts) {
    if (await autoRefreshSession()) return getSiteAccounts();
    return [];
  }
  _siteAccountsCache = data.accounts || [];
  _siteAccountsCachedAt = Date.now();
  return _siteAccountsCache;
}

async function switchSiteAccount(customerId) {
  await fetch(`${SITE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "switch_account", sessionId: SITE_SESSION, customerId }),
  });
  _siteCredsCache = null;
}

async function callSiteGads(action, params = {}, overrideCustomerId = null) {
  const creds = await getSiteCreds();
  if (!creds) throw new Error("Site credentials unavailable — session may have expired");
  const targetCustomerId = overrideCustomerId
    ? overrideCustomerId.replace(/-/g, "")
    : creds.customerId;
  const resp = await fetch(`${SITE_URL}/api/gads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      credentials: {
        refreshToken: creds.refreshToken,
        customerId: targetCustomerId,
        clientId: creds.clientId || "",
        clientSecret: "",
        developerToken: creds.developerToken || "",
        loginCustomerId: creds.loginCustomerId || "",
        accessToken: creds.accessToken || "",
      },
      params,
    }),
  });
  return resp.json();
}

const TOOL_TO_SITE_ACTION = {
  campaign_performance: "list_campaigns",
  search_terms_report: "search_terms",
  keyword_quality: "quality_score_report",
  ad_performance: "ad_performance",
  budget_analysis: "budget_report",
  geo_performance: "geo_performance",
  device_performance: "device_performance",
  impression_share: "impression_share",
  change_history: "change_history",
  list_recommendations: "recommendations",
  account_health: "account_health",
  pause_campaign: "update_campaign_status",
  enable_campaign: "update_campaign_status",
  update_bid: "update_ad_group_bid",
  update_budget: "update_budget",
  add_negative_keywords: "create_negative_keyword",
  create_responsive_search_ad: "create_rsa",
};

function formatSiteResult(data) {
  if (!data) return "No data returned from remote.";
  if (data.error) return `Remote error: ${data.error}`;
  if (typeof data === "string") return data;
  const rows = data.rows || data.results || data.data;
  if (Array.isArray(rows) && rows.length > 0) {
    const count = data.count || data.totalResultsCount || rows.length;
    const summary = data.summary || "";
    const table = JSON.stringify(rows.slice(0, 30), null, 2);
    return `${summary ? summary + "\n\n" : ""}${count} results (showing up to 30):\n\n\`\`\`json\n${table}\n\`\`\``;
  }
  return JSON.stringify(data, null, 2).slice(0, 3000);
}

// ─── Client Setup (Local) ────────────────────────────────────────────────────

const _hasLocalCreds = !!(
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
  process.env.GOOGLE_ADS_CLIENT_ID &&
  process.env.GOOGLE_ADS_CLIENT_SECRET &&
  process.env.GOOGLE_ADS_REFRESH_TOKEN
);

function getClient() {
  if (!_hasLocalCreds) {
    throw new Error(
      "Missing Google Ads credentials. Run: gemini extensions config google-ads-agent"
    );
  }

  return new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });
}

function getCustomerForId(client, customerId) {
  const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  return client.Customer({
    customer_id: customerId.replace(/-/g, ""),
    login_customer_id: loginId,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  });
}

function getMccCustomer(client) {
  const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  return client.Customer({
    customer_id: loginId,
    login_customer_id: loginId,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  });
}

async function tryLocalThenRemote(toolName, customerId, localFn, siteAction, siteParams = {}) {
  if (_hasLocalCreds) {
    try {
      return await localFn();
    } catch (localErr) {
      const errMsg = extractErrorMessage(localErr).toLowerCase();
      if (errMsg.includes("requested_metrics_for_manager")) throw localErr;
      if (!SITE_CONFIGURED) throw localErr;
      const isAccessErr = errMsg.includes("permission") || errMsg.includes("not found") ||
        errMsg.includes("unauthenticated") || errMsg.includes("not authorized") ||
        errMsg.includes("cannot access");
      if (!isAccessErr) throw localErr;
      console.error(`[${toolName}] Local failed (${errMsg.slice(0, 80)}), trying remote...`);
    }
  }
  if (!SITE_CONFIGURED) {
    throw new Error("No local credentials and no remote site configured. Run: gemini extensions config google-ads-agent");
  }
  const cid = customerId ? customerId.replace(/-/g, "") : null;
  const result = await callSiteGads(siteAction, { date_range: siteParams.date_range, ...siteParams }, cid);
  if (result && result.error) {
    const remoteErr = (typeof result.error === "string" ? result.error : extractErrorMessage(result.error)).toLowerCase();
    if (remoteErr.includes("requested_metrics_for_manager")) {
      throw new Error("REQUESTED_METRICS_FOR_MANAGER");
    }
  }
  return formatSiteResult(result);
}

// ─── Shared Schemas ──────────────────────────────────────────────────────────

const customerIdSchema = z
  .string()
  .regex(/^\d{3}-?\d{3}-?\d{4}$/, "Must be a 10-digit customer ID (e.g., 1234567890 or 123-456-7890)")
  .describe("Google Ads customer ID (10 digits)");

const PRESET_DATE_RANGES = [
  "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS",
  "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "LAST_MONTH",
];

const dateRangeSchema = z
  .string()
  .default("LAST_30_DAYS")
  .describe("Preset (LAST_30_DAYS, LAST_90_DAYS, etc.) or custom range as 'YYYY-MM-DD,YYYY-MM-DD' (start,end)");

function parseDateRange(input) {
  if (!input) return { clause: "DURING LAST_30_DAYS", params: { dateRange: "LAST_30_DAYS" } };
  const upper = input.toUpperCase().trim();
  if (PRESET_DATE_RANGES.includes(upper)) return { clause: `DURING ${upper}`, params: { dateRange: upper } };
  const match = input.match(/^(\d{4}-\d{2}-\d{2})\s*[,\s]\s*(\d{4}-\d{2}-\d{2})$/);
  if (match) {
    return { clause: `BETWEEN '${match[1]}' AND '${match[2]}'`, params: { startDate: match[1], endDate: match[2] } };
  }
  return { clause: `DURING ${upper}`, params: { dateRange: upper } };
}

const limitSchema = z.number().min(1).max(200).default(50);

// ─── Enum Labels ─────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  0: "UNSPECIFIED", 1: "UNKNOWN", 2: "ENABLED", 3: "PAUSED", 4: "REMOVED",
  UNSPECIFIED: "UNSPECIFIED", UNKNOWN: "UNKNOWN", ENABLED: "ENABLED", PAUSED: "PAUSED", REMOVED: "REMOVED",
};

const DEVICE_LABELS = {
  0: "UNSPECIFIED", 1: "UNKNOWN", 2: "MOBILE", 3: "DESKTOP", 4: "TABLET", 5: "CONNECTED_TV", 6: "OTHER",
  UNSPECIFIED: "UNSPECIFIED", UNKNOWN: "UNKNOWN", MOBILE: "MOBILE", DESKTOP: "DESKTOP", TABLET: "TABLET", CONNECTED_TV: "CONNECTED_TV", OTHER: "OTHER",
};

const BID_STRATEGY_LABELS = {
  0: "UNSPECIFIED", 1: "UNKNOWN", 2: "COMMISSION", 3: "ENHANCED_CPC", 4: "INVALID",
  5: "MANUAL_CPA", 6: "MANUAL_CPC", 7: "MANUAL_CPM", 8: "MANUAL_CPV",
  9: "MAXIMIZE_CONVERSIONS", 10: "MAXIMIZE_CONVERSION_VALUE", 11: "PAGE_ONE_PROMOTED",
  12: "PERCENT_CPC", 13: "TARGET_CPA", 14: "TARGET_CPM", 15: "TARGET_IMPRESSION_SHARE",
  16: "TARGET_OUTRANK_SHARE", 17: "TARGET_ROAS", 18: "TARGET_SPEND",
  UNSPECIFIED: "UNSPECIFIED", UNKNOWN: "UNKNOWN", COMMISSION: "COMMISSION",
  ENHANCED_CPC: "ENHANCED_CPC", MANUAL_CPC: "MANUAL_CPC", MANUAL_CPM: "MANUAL_CPM",
  MANUAL_CPV: "MANUAL_CPV", MAXIMIZE_CONVERSIONS: "MAXIMIZE_CONVERSIONS",
  MAXIMIZE_CONVERSION_VALUE: "MAXIMIZE_CONVERSION_VALUE", TARGET_CPA: "TARGET_CPA",
  TARGET_IMPRESSION_SHARE: "TARGET_IMPRESSION_SHARE", TARGET_ROAS: "TARGET_ROAS",
  TARGET_SPEND: "TARGET_SPEND", PERCENT_CPC: "PERCENT_CPC",
};

const MATCH_TYPE_LABELS = {
  0: "UNSPECIFIED", 1: "UNKNOWN", 2: "EXACT", 3: "PHRASE", 4: "BROAD",
  UNSPECIFIED: "UNSPECIFIED", UNKNOWN: "UNKNOWN", EXACT: "EXACT", PHRASE: "PHRASE", BROAD: "BROAD",
};

const AD_TYPE_LABELS = {
  0: "UNSPECIFIED", 2: "TEXT_AD", 3: "EXPANDED_TEXT_AD", 6: "HOTEL_AD",
  7: "SHOPPING_SMART_AD", 12: "IMAGE_AD", 13: "VIDEO_AD", 14: "VIDEO_RESPONSIVE_AD",
  15: "RESPONSIVE_SEARCH_AD", 16: "LEGACY_RESPONSIVE_DISPLAY_AD",
  17: "APP_AD", 19: "LEGACY_APP_INSTALL_AD", 20: "RESPONSIVE_DISPLAY_AD",
  21: "LOCAL_AD", 22: "HTML5_UPLOAD_AD", 23: "DYNAMIC_HTML5_AD",
  24: "APP_ENGAGEMENT_AD", 25: "SHOPPING_COMPARISON_LISTING_AD",
  27: "VIDEO_BUMPER_AD", 29: "VIDEO_NON_SKIPPABLE_IN_STREAM_AD",
  31: "SMART_CAMPAIGN_AD", 33: "CALL_AD", 34: "APP_PRE_REGISTRATION_AD",
  36: "DISCOVERY_MULTI_ASSET_AD", 37: "DISCOVERY_CAROUSEL_AD",
  38: "TRAVEL_AD", 39: "DISCOVERY_VIDEO_RESPONSIVE_AD",
  40: "MULTIMEDIA_AD", 42: "DEMAND_GEN_VIDEO_RESPONSIVE_AD",
};

const AD_STRENGTH_LABELS = {
  0: "UNSPECIFIED", 1: "UNKNOWN", 2: "PENDING", 3: "NO_ADS", 4: "POOR",
  5: "AVERAGE", 6: "GOOD", 7: "EXCELLENT",
  UNSPECIFIED: "UNSPECIFIED", UNKNOWN: "UNKNOWN", PENDING: "PENDING",
  NO_ADS: "NO_ADS", POOR: "POOR", AVERAGE: "AVERAGE", GOOD: "GOOD", EXCELLENT: "EXCELLENT",
};

const GEO_LOCATION_LABELS = {
  2004: "Afghanistan", 2008: "Albania", 2012: "Algeria", 2020: "Andorra",
  2024: "Angola", 2032: "Argentina", 2036: "Australia", 2040: "Austria",
  2050: "Bangladesh", 2056: "Belgium", 2076: "Brazil", 2100: "Bulgaria",
  2124: "Canada", 2152: "Chile", 2156: "China", 2170: "Colombia",
  2188: "Costa Rica", 2191: "Croatia", 2196: "Cyprus", 2203: "Czech Republic",
  2208: "Denmark", 2218: "Ecuador", 2818: "Egypt", 2233: "Estonia",
  2246: "Finland", 2250: "France", 2276: "Germany", 2300: "Greece",
  2320: "Guatemala", 2344: "Hong Kong", 2348: "Hungary", 2352: "Iceland",
  2356: "India", 2360: "Indonesia", 2364: "Iran", 2368: "Iraq",
  2372: "Ireland", 2376: "Israel", 2380: "Italy", 2392: "Japan",
  2398: "Kazakhstan", 2404: "Kenya", 2410: "South Korea", 2414: "Kuwait",
  2422: "Lebanon", 2428: "Latvia", 2440: "Lithuania", 2442: "Luxembourg",
  2446: "Macao", 2458: "Malaysia", 2484: "Mexico", 2504: "Morocco",
  2528: "Netherlands", 2554: "New Zealand", 2566: "Nigeria", 2578: "Norway",
  2586: "Pakistan", 2591: "Panama", 2604: "Peru", 2608: "Philippines",
  2616: "Poland", 2620: "Portugal", 2630: "Puerto Rico", 2634: "Qatar",
  2642: "Romania", 2643: "Russia", 2682: "Saudi Arabia", 2688: "Serbia",
  2702: "Singapore", 2703: "Slovakia", 2704: "Vietnam", 2705: "Slovenia",
  2710: "South Africa", 2724: "Spain", 2752: "Sweden", 2756: "Switzerland",
  2158: "Taiwan", 2764: "Thailand", 2784: "UAE", 2792: "Turkey",
  2804: "Ukraine", 2826: "United Kingdom", 2840: "United States",
  2858: "Uruguay", 2862: "Venezuela",
};

const LOCATION_TYPE_LABELS = {
  0: "UNSPECIFIED", 1: "UNKNOWN", 2: "AREA_OF_INTEREST", 3: "LOCATION_OF_PRESENCE",
  AREA_OF_INTEREST: "Area of Interest", LOCATION_OF_PRESENCE: "Location of Presence",
};

function labelStatus(v) { return STATUS_LABELS[v] || String(v); }
function labelDevice(v) { return DEVICE_LABELS[v] || String(v); }
function labelBidStrategy(v) { return BID_STRATEGY_LABELS[v] || String(v); }
function labelMatchType(v) { return MATCH_TYPE_LABELS[v] || String(v); }
function labelAdType(v) { return AD_TYPE_LABELS[v] || String(v); }
function labelAdStrength(v) { return AD_STRENGTH_LABELS[v] || String(v); }
function labelGeo(v) { return GEO_LOCATION_LABELS[v] || String(v); }
function labelLocationType(v) { return LOCATION_TYPE_LABELS[v] || String(v); }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMicros(micros) {
  const n = Number(micros);
  if (!isFinite(n)) return "$0.00";
  return `$${(n / 1_000_000).toFixed(2)}`;
}

function formatPercent(value) {
  const n = Number(value);
  if (!isFinite(n)) return "0.00%";
  return `${(n * 100).toFixed(2)}%`;
}

function safeCtr(clicks, impressions) {
  const c = Number(clicks), i = Number(impressions);
  if (!isFinite(c) || !isFinite(i) || i === 0) return "0.00%";
  return `${((c / i) * 100).toFixed(2)}%`;
}

function safeCpc(costMicros, clicks) {
  const cost = Number(costMicros), c = Number(clicks);
  if (!isFinite(cost) || !isFinite(c) || c === 0) return "$0.00";
  return formatMicros(cost / c);
}

function safeCpa(costMicros, conversions) {
  const cost = Number(costMicros), conv = Number(conversions);
  if (!isFinite(cost) || !isFinite(conv) || conv === 0) return "—";
  return formatMicros(cost / conv);
}

function text(str) {
  return { content: [{ type: "text", text: str }] };
}

function fmt(rows, formatFn) {
  if (!rows || rows.length === 0) return "No data found.";
  return formatFn(rows);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS — using server.tool(name, description, zodSchema, handler)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Dual-lane sign-in tools (Remote identities) ─────────────────────────────

function localCredsStatus() {
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ];
  const missing = required.filter((k) => !process.env[k]);
  return {
    active: missing.length === 0,
    missing,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
  };
}

server.tool(
  "remote_login",
  "Sign in to the Remote (googleadsagent.ai) backend with ANY Google account that has Google Ads access. Opens your browser for Google's OAuth consent, exchanges tokens via PKCE, mints a googleadsagent.ai session, and saves the identity (refresh token in your OS keychain, metadata in sessions.json). After login the new identity becomes active for all Remote tool calls. You can run this again with a different Google account to add another identity; use remote_switch to hop between them.",
  async () => {
    try {
      if (!SITE_URL) {
        return text("Remote backend not configured. Set GADS_SITE_URL in your extension .env (e.g., https://googleadsagent.ai).");
      }
      const clientId = process.env.GADS_CLI_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID;
      if (!clientId) {
        return text("OAuth client ID missing. Set GADS_CLI_OAUTH_CLIENT_ID (preferred) or GOOGLE_ADS_CLIENT_ID in your extension .env.");
      }

      let promptUrl = null;
      const result = await runLoginFlow({
        clientId,
        siteUrl: SITE_URL,
        onPrompt: (url) => { promptUrl = url; console.error(`[google-ads-agent] If the browser did not open, visit:\n${url}`); },
      });

      await sessionStore.save({
        email: result.email,
        refreshToken: result.refreshToken,
        sessionId: result.sessionId,
        accountsCount: result.accountsCount,
      });
      setActiveSession({ sessionId: result.sessionId, email: result.email });

      const lines = [
        `✅ Signed in as **${result.email}**`,
        result.accountsCount != null ? `   ${result.accountsCount} Google Ads accounts accessible` : null,
        `   session: ${redactSecret(result.sessionId)}`,
        `   backend: ${(await sessionStore.backendInfo()).backend} (secret storage)`,
        "",
        "Active identity switched. Run `list_accounts` to see your accounts.",
        promptUrl ? null : null,
      ].filter(Boolean);
      return text(lines.join("\n"));
    } catch (e) {
      return text(`Sign-in failed: ${e.message}`);
    }
  }
);

server.tool(
  "remote_switch",
  "Switch the active Remote identity to a previously signed-in Google account. No browser, no re-auth — uses the refresh token already stored in your OS keychain. Use remote_status to list stored identities.",
  { email: z.string().email().describe("Email address of a stored identity (see remote_status)") },
  async ({ email }) => {
    try {
      const id = await sessionStore.getIdentity(email);
      if (!id) return text(`No stored identity for ${email}. Run remote_login first.`);

      // Mint a fresh session from the stored refresh token so we always
      // hand a valid sessionId to the remote backend.
      if (!SITE_URL) return text("Remote backend not configured (GADS_SITE_URL missing).");
      const resp = await fetch(`${SITE_URL}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_api_session", refreshToken: id.refreshToken }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!data.sessionId) {
        return text(`Session mint failed for ${email}: ${data.error || resp.statusText}. You may need to remote_login again.`);
      }
      await sessionStore.updateSessionId(email, data.sessionId);
      await sessionStore.setActive(email);
      setActiveSession({ sessionId: data.sessionId, email });
      return text(`✅ Active identity switched to **${email}** (${data.accounts ?? "?"} accounts).`);
    } catch (e) {
      return text(`Switch failed: ${e.message}`);
    }
  }
);

server.tool(
  "remote_status",
  "Show the current authentication state of BOTH lanes: Method 1 (Local Google Ads API) and Method 2 (Remote googleadsagent.ai). Lists all stored Remote identities and which one is active. Never prints tokens.",
  async () => {
    try {
      const [list, backend, local] = await Promise.all([
        sessionStore.listIdentities(),
        sessionStore.backendInfo(),
        Promise.resolve(localCredsStatus()),
      ]);

      const lines = [];
      lines.push("## Method 1 — Local Google Ads API");
      if (local.active) {
        lines.push(`  status:  active`);
        lines.push(`  MCC:     ${local.loginCustomerId || "(not set)"}`);
      } else {
        lines.push(`  status:  inactive`);
        lines.push(`  missing: ${local.missing.join(", ")}`);
        lines.push(`  fix:     run \`gemini extensions config google-ads-agent\` or set env vars in .env`);
      }
      lines.push("");
      lines.push("## Method 2 — Remote (googleadsagent.ai)");
      if (!SITE_URL) {
        lines.push(`  status:  unconfigured (set GADS_SITE_URL)`);
      } else {
        lines.push(`  site:    ${SITE_URL}`);
        lines.push(`  active:  ${list.active || "(none — run /google-ads:login)"}`);
        lines.push(`  storage: ${backend.backend === "keychain" ? "OS keychain (keytar)" : "file (sessions.secrets.json, 0600)"}`);
        if (list.identities.length === 0) {
          lines.push(`  identities: (none stored)`);
        } else {
          lines.push(`  identities:`);
          for (const i of list.identities) {
            const star = i.email === list.active ? "*" : " ";
            lines.push(`   ${star} ${i.email}  (accounts: ${i.accountsCount ?? "?"}, added: ${i.addedAt?.slice(0, 10) || "?"})`);
          }
        }
      }
      return text(lines.join("\n"));
    } catch (e) {
      return text(`Status error: ${e.message}`);
    }
  }
);

server.tool(
  "remote_logout",
  "Revoke and remove a stored Remote identity. If no email is given, removes the currently active one. Calls Google's token revocation endpoint so the refresh token can't outlive the sign-out, then clears the OS keychain entry and sessions.json metadata.",
  { email: z.string().email().optional().describe("Email to log out. Defaults to the currently active identity.") },
  async ({ email }) => {
    try {
      const list = await sessionStore.listIdentities();
      const target = email || list.active;
      if (!target) return text("No active Remote identity to log out.");
      const id = await sessionStore.getIdentity(target);
      if (id?.refreshToken) {
        const revoked = await revokeRefreshToken(id.refreshToken);
        if (!revoked) console.error(`[google-ads-agent] Token revoke returned non-OK for ${target} (ignored).`);
      }
      const newActive = await sessionStore.remove(target);
      if (target === SITE_ACTIVE_EMAIL) {
        if (newActive) {
          const next = await sessionStore.getActive();
          setActiveSession({ sessionId: next?.sessionId, email: next?.email });
        } else {
          setActiveSession({ sessionId: "", email: null });
        }
      }
      const tail = newActive ? `Active is now **${newActive}**.` : "No more stored identities. Run remote_login to sign in.";
      return text(`✅ Removed **${target}**. ${tail}`);
    } catch (e) {
      return text(`Logout failed: ${e.message}`);
    }
  }
);

// ─── list_accounts ───────────────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List all Google Ads accounts accessible under the configured MCC. Merges local + remote (googleadsagent.ai) if both are configured.",
  async () => {
    try {
      checkRateLimit("list_accounts");
      let localRows = [];
      let remoteAccounts = [];
      const errors = [];

      if (_hasLocalCreds) {
        try {
          const client = getClient();
          const customer = getMccCustomer(client);
          const results = await customer.query(`
            SELECT customer_client.id, customer_client.descriptive_name,
                   customer_client.status, customer_client.manager,
                   customer_client.currency_code
            FROM customer_client
            WHERE customer_client.status = 'ENABLED'
            ORDER BY customer_client.descriptive_name
          `);
          localRows = results;
        } catch (e) {
          errors.push(`Local: ${e.message.slice(0, 100)}`);
        }
      }

      if (SITE_CONFIGURED) {
        try {
          remoteAccounts = await getSiteAccounts();
        } catch (e) {
          errors.push(`Remote: ${e.message.slice(0, 100)}`);
        }
      }

      const seenIds = new Set();
      const merged = [];

      for (const r of localRows) {
        const c = r.customer_client;
        const id = String(c.id).replace(/-/g, "");
        seenIds.add(id);
        merged.push({ id, name: c.descriptive_name, manager: c.manager ? "Yes" : "No", currency: c.currency_code, source: "Local" });
      }

      for (const a of remoteAccounts) {
        const id = String(a.id || a.customerId || "").replace(/-/g, "");
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push({ id, name: a.name || a.descriptive_name || "—", manager: a.manager ? "Yes" : "No", currency: a.currency || "—", source: "Remote" });
      }

      if (merged.length === 0) {
        const errMsg = errors.length > 0 ? ` Errors: ${errors.join("; ")}` : "";
        return text(`No accounts found.${errMsg}`);
      }

      const header = "| Account ID | Name | Manager | Currency | Source |\n|---|---|---|---|---|";
      const body = merged.map((a) => `| ${a.id} | ${a.name} | ${a.manager} | ${a.currency} | ${a.source} |`).join("\n");
      let summary = `Found ${merged.length} accounts`;
      if (localRows.length > 0 && remoteAccounts.length > 0) {
        summary += ` (${localRows.length} local, ${remoteAccounts.length - seenIds.size + merged.length - localRows.length} remote-only)`;
      }
      return text(`${summary}:\n\n${header}\n${body}`);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── list_sub_accounts ──────────────────────────────────────────────────────

server.tool(
  "list_sub_accounts",
  "List sub-accounts (children) under an MCC/manager account. Use this when you get a 'REQUESTED_METRICS_FOR_MANAGER' error — it means you need to query leaf accounts instead.",
  {
    customer_id: customerIdSchema.describe("The MCC/manager account ID whose children you want to list"),
  },
  async ({ customer_id }) => {
    try {
      checkRateLimit("list_sub_accounts");
      const cid = customer_id.replace(/-/g, "");

      if (_hasLocalCreds) {
        try {
          const client = getClient();
          const customer = client.Customer({
            customer_id: cid,
            login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "") || cid,
            refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
          });
          const results = await customer.query(`
            SELECT customer_client.id, customer_client.descriptive_name,
                   customer_client.manager, customer_client.currency_code,
                   customer_client.status
            FROM customer_client
            WHERE customer_client.status = 'ENABLED'
            ORDER BY customer_client.descriptive_name
          `);
          if (results.length === 0) return text(`No sub-accounts found under MCC ${cid}.`);
          const header = "| Account ID | Name | Manager | Currency | Query This? |\n|---|---|---|---|---|";
          const body = results.map((r) => {
            const c = r.customer_client;
            const isManager = c.manager;
            const hint = isManager ? "No — this is also an MCC, list its sub-accounts" : "Yes — this is a leaf account";
            return `| ${c.id} | ${c.descriptive_name} | ${isManager ? "Yes" : "No"} | ${c.currency_code} | ${hint} |`;
          }).join("\n");
          const leafCount = results.filter((r) => !r.customer_client.manager).length;
          const mccCount = results.filter((r) => r.customer_client.manager).length;
          return text(`Sub-accounts under MCC ${cid}: ${results.length} total (${leafCount} leaf accounts, ${mccCount} sub-MCCs)\n\n**Query the leaf accounts (Manager = No) for performance data.**\n\n${header}\n${body}`);
        } catch (localErr) {
          if (!SITE_CONFIGURED) throw localErr;
          console.error(`[list_sub_accounts] Local failed, trying remote...`);
        }
      }

      if (SITE_CONFIGURED) {
        const accounts = await getSiteAccounts();
        const mccEntry = accounts.find((a) => String(a.id || "").replace(/-/g, "") === cid);
        const mccName = mccEntry ? (mccEntry.name || "") : "";
        const namePrefix = mccName.replace(/\s*MCC.*$/i, "").replace(/\s*\(new\).*$/i, "").trim();
        let filtered = [];
        if (namePrefix.length > 2) {
          filtered = accounts.filter((a) => {
            const n = (a.name || "").toUpperCase();
            const p = namePrefix.toUpperCase();
            return !a.manager && (n.startsWith(p) || n.includes(p));
          });
        }
        if (filtered.length === 0) {
          filtered = accounts.filter((a) => !a.manager);
        }
        const header = "| Account ID | Name | Currency |\n|---|---|---|";
        const body = filtered.slice(0, 100).map((a) =>
          `| ${String(a.id || "").replace(/-/g, "")} | ${a.name || "—"} | ${a.currency || "—"} |`
        ).join("\n");
        const note = filtered.length > 100 ? `\n\n(Showing first 100 of ${filtered.length})` : "";
        return text(`Leaf accounts${mccName ? ` related to "${mccName}"` : ""}: ${filtered.length} found\n\n**Query these accounts for performance data (not the MCC).**\n\n${header}\n${body}${note}`);
      }

      return text("No backends available to list sub-accounts.");
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── campaign_performance ────────────────────────────────────────────────────

server.tool(
  "campaign_performance",
  "Campaign performance metrics — spend, conversions, clicks, impressions, CTR, CPC, CPA.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    status: z.enum(["ENABLED", "PAUSED", "ALL"]).default("ENABLED"),
    limit: limitSchema.default(20),
  },
  async ({ customer_id, date_range, status, limit }) => {
    try {
      checkRateLimit("campaign_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "campaign_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const statusClause = status === "ALL" ? "" : `AND campaign.status = '${status}'`;
          const results = await customer.query(`
            SELECT campaign.id, campaign.name, campaign.status,
                   campaign.bidding_strategy_type,
                   metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value, metrics.clicks,
                   metrics.impressions, metrics.ctr, metrics.average_cpc,
                   metrics.cost_per_conversion
            FROM campaign
            WHERE segments.date ${dr.clause} ${statusClause}
            ORDER BY metrics.cost_micros DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const totalSpend = rows.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
            const totalConv = rows.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
            const header = "| Campaign | Status | Spend | Conv | Clicks | Impr | CTR | CPC | CPA |\n|---|---|---|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const m = r.metrics;
                return `| ${r.campaign.name} | ${labelStatus(r.campaign.status)} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | ${m.clicks || 0} | ${m.impressions || 0} | ${safeCtr(m.clicks, m.impressions)} | ${safeCpc(m.cost_micros, m.clicks)} | ${safeCpa(m.cost_micros, m.conversions)} |`;
              })
              .join("\n");
            return `Campaign Performance (${date_range}) — ${rows.length} campaigns\n\n**Totals**: ${formatMicros(totalSpend)} spend, ${totalConv.toFixed(1)} conversions\n\n${header}\n${body}`;
          });
        },
        "list_campaigns",
        { ...dr.params, status, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── search_terms_report ─────────────────────────────────────────────────────

server.tool(
  "search_terms_report",
  "Search terms that triggered ads — wasted spend detection and top performers.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema,
    sort_by: z.enum(["cost", "conversions", "clicks", "impressions"]).default("cost"),
  },
  async ({ customer_id, date_range, limit, sort_by }) => {
    try {
      checkRateLimit("search_terms_report");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "search_terms_report", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const orderMap = { cost: "metrics.cost_micros", conversions: "metrics.conversions", clicks: "metrics.clicks", impressions: "metrics.impressions" };
          const results = await customer.query(`
            SELECT search_term_view.search_term, search_term_view.status,
                   campaign.name, ad_group.name,
                   metrics.impressions, metrics.clicks, metrics.conversions,
                   metrics.cost_micros, metrics.ctr, metrics.cost_per_conversion
            FROM search_term_view
            WHERE segments.date ${dr.clause}
            ORDER BY ${orderMap[sort_by]} DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const wastedRows = rows.filter((r) => Number(r.metrics.conversions) === 0 && Number(r.metrics.cost_micros) > 0);
            const wastedSpend = wastedRows.reduce((s, r) => s + Number(r.metrics.cost_micros), 0);
            const header = "| Search Term | Campaign | Clicks | Conv | Spend | CTR | CPA |\n|---|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const m = r.metrics;
                return `| ${r.search_term_view.search_term} | ${r.campaign.name} | ${m.clicks || 0} | ${Number(m.conversions || 0).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${safeCtr(m.clicks, m.impressions)} | ${safeCpa(m.cost_micros, m.conversions)} |`;
              })
              .join("\n");
            let summary = `Search Terms (${date_range}) — ${rows.length} terms\n\n`;
            if (wastedRows.length > 0) summary += `**Wasted spend**: ${formatMicros(wastedSpend)} across ${wastedRows.length} terms with zero conversions\n\n`;
            return `${summary}${header}\n${body}`;
          });
        },
        "list_search_terms",
        { ...dr.params, limit, sort_by }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── keyword_quality ─────────────────────────────────────────────────────────

server.tool(
  "keyword_quality",
  "Keyword quality scores with component breakdowns (creative, landing page, expected CTR).",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    min_impressions: z.number().default(10),
    limit: limitSchema,
  },
  async ({ customer_id, date_range, min_impressions, limit }) => {
    try {
      checkRateLimit("keyword_quality");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "keyword_quality", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT ad_group_criterion.keyword.text,
                   ad_group_criterion.keyword.match_type,
                   ad_group_criterion.quality_info.quality_score,
                   ad_group_criterion.quality_info.creative_quality_score,
                   ad_group_criterion.quality_info.post_click_quality_score,
                   ad_group_criterion.quality_info.search_predicted_ctr,
                   campaign.name, ad_group.name,
                   metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
            FROM keyword_view
            WHERE segments.date ${dr.clause}
              AND ad_group_criterion.status = 'ENABLED'
              AND metrics.impressions > ${min_impressions}
            ORDER BY ad_group_criterion.quality_info.quality_score ASC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const lowQS = rows.filter((r) => Number(r.ad_group_criterion?.quality_info?.quality_score || 10) < 5);
            const header = "| Keyword | Match | QS | Creative | Landing | CTR Pred | Campaign | Impr | Spend |\n|---|---|---|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const kw = r.ad_group_criterion;
                const qi = kw.quality_info || {};
                const qs = qi.quality_score ?? "—";
                return `| ${kw.keyword.text} | ${labelMatchType(kw.keyword.match_type)} | ${qs}/10 | ${qi.creative_quality_score || "—"} | ${qi.post_click_quality_score || "—"} | ${qi.search_predicted_ctr || "—"} | ${r.campaign.name} | ${r.metrics.impressions} | ${formatMicros(r.metrics.cost_micros)} |`;
              })
              .join("\n");
            let summary = `Keyword Quality (${date_range}) — ${rows.length} keywords\n\n`;
            if (lowQS.length > 0) summary += `**${lowQS.length} keywords with QS < 5** need attention\n\n`;
            return `${summary}${header}\n${body}`;
          });
        },
        "quality_score_report",
        { ...dr.params, min_impressions, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── ad_performance ──────────────────────────────────────────────────────────

server.tool(
  "ad_performance",
  "Ad creative performance — RSA ad strength, clicks, conversions, fatigue signals.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("ad_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "ad_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
                   ad_group_ad.ad_strength, ad_group_ad.status,
                   campaign.name, ad_group.name,
                   metrics.impressions, metrics.clicks,
                   metrics.conversions, metrics.cost_micros,
                   metrics.ctr, metrics.average_cpc
            FROM ad_group_ad
            WHERE segments.date ${dr.clause}
              AND ad_group_ad.status = 'ENABLED'
            ORDER BY metrics.impressions DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Ad ID | Type | Strength | Campaign | Ad Group | Impr | Clicks | Conv | Spend | CTR |\n|---|---|---|---|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const ad = r.ad_group_ad;
                const m = r.metrics;
                return `| ${ad.ad.id} | ${labelAdType(ad.ad.type)} | ${labelAdStrength(ad.ad_strength)} | ${r.campaign.name} | ${r.ad_group.name} | ${m.impressions || 0} | ${m.clicks || 0} | ${Number(m.conversions || 0).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${safeCtr(m.clicks, m.impressions)} |`;
              })
              .join("\n");
            return `Ad Performance (${date_range}) — ${rows.length} ads\n\n${header}\n${body}`;
          });
        },
        "list_ads",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── budget_analysis ─────────────────────────────────────────────────────────

server.tool(
  "budget_analysis",
  "Budget allocation and efficiency — identifies budget-limited campaigns and misallocated spend.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
  },
  async ({ customer_id, date_range }) => {
    try {
      checkRateLimit("budget_analysis");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "budget_analysis", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign.name, campaign.status,
                   campaign_budget.amount_micros,
                   campaign_budget.has_recommended_budget,
                   campaign_budget.recommended_budget_amount_micros,
                   campaign.bidding_strategy_type,
                   metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value, metrics.clicks, metrics.impressions
            FROM campaign
            WHERE segments.date ${dr.clause} AND campaign.status = 'ENABLED'
            ORDER BY metrics.cost_micros DESC
          `);
          return fmt(results, (rows) => {
            const totalSpend = rows.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
            const budgetLimited = rows.filter((r) => r.campaign_budget.has_recommended_budget);
            const header = "| Campaign | Daily Budget | Spend | % of Total | Conv | ROAS | Bid Strategy | Budget Limited |\n|---|---|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const m = r.metrics;
                const b = r.campaign_budget;
                const pct = totalSpend > 0 ? ((Number(m.cost_micros) / totalSpend) * 100).toFixed(1) : "0";
                const roas = Number(m.cost_micros) > 0 ? (Number(m.conversions_value) / (Number(m.cost_micros) / 1_000_000)).toFixed(2) : "—";
                const limited = b.has_recommended_budget ? `Yes → ${formatMicros(b.recommended_budget_amount_micros)}` : "No";
                return `| ${r.campaign.name} | ${formatMicros(b.amount_micros)} | ${formatMicros(m.cost_micros)} | ${pct}% | ${Number(m.conversions || 0).toFixed(1)} | ${roas}x | ${labelBidStrategy(r.campaign.bidding_strategy_type)} | ${limited} |`;
              })
              .join("\n");
            let summary = `Budget Analysis (${date_range}) — ${rows.length} campaigns\n\n**Total spend**: ${formatMicros(totalSpend)}\n`;
            if (budgetLimited.length > 0) summary += `**${budgetLimited.length} campaigns budget-limited**\n`;
            return `${summary}\n${header}\n${body}`;
          });
        },
        "budget_report",
        { ...dr.params }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── geo_performance ─────────────────────────────────────────────────────────

server.tool(
  "geo_performance",
  "Geographic performance breakdown by location.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("geo_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "geo_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT geographic_view.country_criterion_id,
                   geographic_view.location_type, campaign.name,
                   metrics.impressions, metrics.clicks,
                   metrics.conversions, metrics.cost_micros,
                   metrics.ctr, metrics.cost_per_conversion
            FROM geographic_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Location | Type | Campaign | Impr | Clicks | Conv | Spend | CTR | CPA |\n|---|---|---|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const m = r.metrics;
                const locId = r.geographic_view.country_criterion_id;
                const locName = labelGeo(locId);
                const locDisplay = locName !== String(locId) ? locName : `ID:${locId}`;
                return `| ${locDisplay} | ${labelLocationType(r.geographic_view.location_type)} | ${r.campaign.name} | ${m.impressions || 0} | ${m.clicks || 0} | ${Number(m.conversions || 0).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${safeCtr(m.clicks, m.impressions)} | ${safeCpa(m.cost_micros, m.conversions)} |`;
              })
              .join("\n");
            return `Geographic Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "geo_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── device_performance ──────────────────────────────────────────────────────

server.tool(
  "device_performance",
  "Performance breakdown by device (mobile, desktop, tablet) — identifies device-level optimization opportunities.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
  },
  async ({ customer_id, date_range }) => {
    try {
      checkRateLimit("device_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "device_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT segments.device, campaign.name,
                   metrics.cost_micros, metrics.conversions,
                   metrics.clicks, metrics.impressions,
                   metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
            FROM campaign
            WHERE segments.date ${dr.clause}
              AND campaign.status = 'ENABLED'
            ORDER BY metrics.cost_micros DESC
          `);
          return fmt(results, (rows) => {
            const byDevice = {};
            for (const r of rows) {
              const d = r.segments.device;
              if (!byDevice[d]) byDevice[d] = { spend: 0, conv: 0, clicks: 0, impr: 0 };
              byDevice[d].spend += Number(r.metrics.cost_micros || 0);
              byDevice[d].conv += Number(r.metrics.conversions || 0);
              byDevice[d].clicks += Number(r.metrics.clicks || 0);
              byDevice[d].impr += Number(r.metrics.impressions || 0);
            }
            const header = "| Device | Spend | Conversions | Clicks | Impr | CTR | CPA |\n|---|---|---|---|---|---|---|";
            const body = Object.entries(byDevice)
              .sort((a, b) => b[1].spend - a[1].spend)
              .map(([device, d]) => {
                return `| ${labelDevice(device)} | ${formatMicros(d.spend)} | ${d.conv.toFixed(1)} | ${d.clicks} | ${d.impr} | ${safeCtr(d.clicks, d.impr)} | ${d.conv > 0 ? formatMicros(d.spend / d.conv) : "—"} |`;
              })
              .join("\n");
            return `Device Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "device_performance",
        { ...dr.params }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── impression_share ────────────────────────────────────────────────────────

server.tool(
  "impression_share",
  "Impression share analysis — identifies lost opportunity from budget and rank. Shows how much traffic you're missing.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(20),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("impression_share");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "impression_share", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign.name, campaign.status,
                   metrics.search_impression_share,
                   metrics.search_budget_lost_impression_share,
                   metrics.search_rank_lost_impression_share,
                   metrics.cost_micros, metrics.impressions,
                   metrics.clicks, metrics.conversions
            FROM campaign
            WHERE segments.date ${dr.clause}
              AND campaign.status = 'ENABLED'
              AND metrics.impressions > 0
            ORDER BY metrics.search_budget_lost_impression_share DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Campaign | Impr Share | Lost (Budget) | Lost (Rank) | Spend | Conv |\n|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const m = r.metrics;
                const is = m.search_impression_share ? (Number(m.search_impression_share) * 100).toFixed(1) + "%" : "—";
                const lb = m.search_budget_lost_impression_share ? (Number(m.search_budget_lost_impression_share) * 100).toFixed(1) + "%" : "—";
                const lr = m.search_rank_lost_impression_share ? (Number(m.search_rank_lost_impression_share) * 100).toFixed(1) + "%" : "—";
                return `| ${r.campaign.name} | ${is} | ${lb} | ${lr} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} |`;
              })
              .join("\n");
            return `Impression Share (${date_range})\n\n${header}\n${body}`;
          });
        },
        "impression_share",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── change_history ──────────────────────────────────────────────────────────

server.tool(
  "change_history",
  "Recent account changes — who changed what and when. Essential for diagnosing performance shifts.",
  {
    customer_id: customerIdSchema,
    limit: limitSchema.default(25),
  },
  async ({ customer_id, limit }) => {
    try {
      checkRateLimit("change_history");
      const result = await tryLocalThenRemote(
        "change_history", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT change_event.change_date_time,
                   change_event.change_resource_type,
                   change_event.resource_change_operation,
                   change_event.user_email,
                   change_event.client_type,
                   change_event.changed_fields,
                   campaign.name
            FROM change_event
            WHERE change_event.change_date_time DURING LAST_14_DAYS
            ORDER BY change_event.change_date_time DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Date | Resource | Operation | User | Campaign | Changed Fields |\n|---|---|---|---|---|---|";
            const body = rows
              .map((r) => {
                const ev = r.change_event;
                const fields = Array.isArray(ev.changed_fields) ? ev.changed_fields.join(", ") : String(ev.changed_fields || "—");
                return `| ${ev.change_date_time} | ${ev.change_resource_type} | ${ev.resource_change_operation} | ${ev.user_email || "System"} | ${r.campaign?.name || "—"} | ${fields.slice(0, 80)} |`;
              })
              .join("\n");
            return `Change History (Last 14 Days) — ${rows.length} changes\n\n${header}\n${body}`;
          });
        },
        "change_history",
        { limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── list_recommendations ────────────────────────────────────────────────────

server.tool(
  "list_recommendations",
  "Google's optimization recommendations for the account — with estimated impact.",
  {
    customer_id: customerIdSchema,
    limit: limitSchema.default(20),
  },
  async ({ customer_id, limit }) => {
    try {
      checkRateLimit("list_recommendations");
      const result = await tryLocalThenRemote(
        "list_recommendations", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          let results;
          try {
            results = await customer.query(`
              SELECT recommendation.type,
                     recommendation.impact.base_metrics.impressions,
                     recommendation.impact.base_metrics.clicks,
                     recommendation.impact.base_metrics.cost_micros,
                     recommendation.impact.potential_metrics.impressions,
                     recommendation.impact.potential_metrics.clicks,
                     recommendation.impact.potential_metrics.cost_micros,
                     recommendation.campaign_budget, recommendation.campaign
              FROM recommendation
              LIMIT ${limit}
            `);
          } catch (queryErr) {
            results = await customer.query(`
              SELECT recommendation.type, recommendation.campaign
              FROM recommendation
              LIMIT ${limit}
            `).catch(() => []);
          }
          if (!results || results.length === 0) return "No recommendations available for this account at this time.";
          return fmt(results, (rows) => {
            const hasImpact = rows.some((r) => r.recommendation?.impact?.base_metrics);
            if (hasImpact) {
              const header = "| Type | Est. Impr Lift | Est. Click Lift | Est. Cost Change | Campaign |\n|---|---|---|---|---|";
              const body = rows
                .map((r) => {
                  const rec = r.recommendation;
                  const impact = rec.impact || {};
                  const base = impact.base_metrics || {};
                  const pot = impact.potential_metrics || {};
                  const imprLift = Number(pot.impressions || 0) - Number(base.impressions || 0);
                  const clickLift = Number(pot.clicks || 0) - Number(base.clicks || 0);
                  const costChange = Number(pot.cost_micros || 0) - Number(base.cost_micros || 0);
                  const campName = rec.campaign ? rec.campaign.split("/").pop() : "—";
                  return `| ${rec.type} | +${imprLift} | +${clickLift} | ${formatMicros(costChange)} | ${campName} |`;
                })
                .join("\n");
              return `Recommendations — ${rows.length} active\n\n${header}\n${body}`;
            }
            const header = "| # | Type | Campaign |\n|---|---|---|";
            const body = rows
              .map((r, i) => {
                const rec = r.recommendation;
                const campName = rec.campaign ? rec.campaign.split("/").pop() : "—";
                return `| ${i + 1} | ${rec.type} | ${campName} |`;
              })
              .join("\n");
            return `Recommendations — ${rows.length} active\n\n${header}\n${body}`;
          });
        },
        "list_recommendations",
        { limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── compare_performance ─────────────────────────────────────────────────────

server.tool(
  "compare_performance",
  "Compare campaign performance across two periods (e.g., this month vs last month). Shows deltas and identifies trends.",
  {
    customer_id: customerIdSchema,
    period_a: z.enum(["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "THIS_MONTH"]).describe("Current/recent period"),
    period_b: z.enum(["LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "LAST_MONTH"]).describe("Comparison period"),
    limit: limitSchema.default(15),
  },
  async ({ customer_id, period_a, period_b, limit }) => {
    try {
      checkRateLimit("compare_performance");
      const result = await tryLocalThenRemote(
        "compare_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const [resultsA, resultsB] = await Promise.all([
            customer.query(`
              SELECT campaign.id, campaign.name,
                     metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions
              FROM campaign WHERE segments.date DURING ${period_a} AND campaign.status = 'ENABLED'
              ORDER BY metrics.cost_micros DESC LIMIT ${limit}
            `),
            customer.query(`
              SELECT campaign.id, campaign.name,
                     metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions
              FROM campaign WHERE segments.date DURING ${period_b} AND campaign.status = 'ENABLED'
              ORDER BY metrics.cost_micros DESC LIMIT ${limit}
            `),
          ]);
          const mapB = new Map();
          for (const r of resultsB) mapB.set(r.campaign.id, r.metrics);
          const header = "| Campaign | Spend (A) | Spend (B) | Δ Spend | Conv (A) | Conv (B) | Δ Conv |\n|---|---|---|---|---|---|---|";
          const body = resultsA
            .map((r) => {
              const mA = r.metrics;
              const mB = mapB.get(r.campaign.id) || {};
              const spendA = Number(mA.cost_micros || 0);
              const spendB = Number(mB.cost_micros || 0);
              const convA = Number(mA.conversions || 0);
              const convB = Number(mB.conversions || 0);
              const dSpend = spendB > 0 ? (((spendA - spendB) / spendB) * 100).toFixed(1) : "new";
              const dConv = convB > 0 ? (((convA - convB) / convB) * 100).toFixed(1) : "new";
              return `| ${r.campaign.name} | ${formatMicros(spendA)} | ${formatMicros(spendB)} | ${dSpend}% | ${convA.toFixed(1)} | ${convB.toFixed(1)} | ${dConv}% |`;
            })
            .join("\n");
          return `Period Comparison: ${period_a} vs ${period_b}\n\n${header}\n${body}`;
        },
        "compare_performance",
        { period_a, period_b, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── calculate ───────────────────────────────────────────────────────────────

server.tool(
  "calculate",
  "Google Ads math calculator — budget projections, ROAS, CPA, conversion forecasts, impression share opportunity. No API call needed.",
  {
    calculation: z.enum([
      "budget_projection", "roas", "cpa", "conversion_forecast", "impression_share_opportunity",
    ]).describe("Type of calculation"),
    inputs: z.object({
      spend: z.number().optional().describe("Total spend in dollars"),
      conversions: z.number().optional(),
      conversion_value: z.number().optional().describe("Total conversion value in dollars"),
      clicks: z.number().optional(),
      impressions: z.number().optional(),
      ctr: z.number().optional().describe("CTR as decimal (e.g., 0.05 for 5%)"),
      conversion_rate: z.number().optional().describe("Conv rate as decimal"),
      target_cpa: z.number().optional(),
      target_roas: z.number().optional(),
      daily_budget: z.number().optional(),
      days: z.number().optional().default(30),
      current_impression_share: z.number().optional().describe("Current IS as decimal"),
    }),
  },
  async ({ calculation, inputs }) => {
    try {
      checkRateLimit("calculate");
      const i = inputs;
      let result = "";

      switch (calculation) {
        case "budget_projection": {
          const daily = i.daily_budget || (i.spend && i.days ? i.spend / i.days : 0);
          const monthly = daily * 30.4;
          const quarterly = daily * 91;
          const yearly = daily * 365;
          result = `**Budget Projection**\n| Period | Budget |\n|---|---|\n| Daily | $${daily.toFixed(2)} |\n| Monthly | $${monthly.toFixed(2)} |\n| Quarterly | $${quarterly.toFixed(2)} |\n| Yearly | $${yearly.toFixed(2)} |`;
          break;
        }
        case "roas": {
          const roas = i.spend > 0 ? (i.conversion_value || 0) / i.spend : 0;
          const targetSpend = i.target_roas > 0 && i.conversion_value ? i.conversion_value / i.target_roas : null;
          result = `**ROAS**: ${roas.toFixed(2)}x\nRevenue: $${(i.conversion_value || 0).toFixed(2)} / Spend: $${(i.spend || 0).toFixed(2)}`;
          if (targetSpend) result += `\nTo hit ${i.target_roas}x ROAS, max spend = $${targetSpend.toFixed(2)}`;
          break;
        }
        case "cpa": {
          const cpa = i.conversions > 0 ? (i.spend || 0) / i.conversions : 0;
          const targetConv = i.target_cpa > 0 && i.spend ? i.spend / i.target_cpa : null;
          result = `**CPA**: $${cpa.toFixed(2)}\nSpend: $${(i.spend || 0).toFixed(2)} / Conversions: ${(i.conversions || 0).toFixed(1)}`;
          if (targetConv) result += `\nAt $${i.target_cpa} target CPA, you need ${targetConv.toFixed(0)} conversions`;
          break;
        }
        case "conversion_forecast": {
          const cr = i.conversion_rate || (i.conversions && i.clicks ? i.conversions / i.clicks : 0);
          const ctr = i.ctr || (i.clicks && i.impressions ? i.clicks / i.impressions : 0);
          const projClicks = i.daily_budget && i.spend && i.clicks ? (i.daily_budget / (i.spend / i.clicks)) * (i.days || 30) : i.clicks || 0;
          const projConv = projClicks * cr;
          result = `**Conversion Forecast**\n| Metric | Value |\n|---|---|\n| CTR | ${(ctr * 100).toFixed(2)}% |\n| Conv Rate | ${(cr * 100).toFixed(2)}% |\n| Projected Clicks | ${projClicks.toFixed(0)} |\n| Projected Conversions | ${projConv.toFixed(1)} |`;
          break;
        }
        case "impression_share_opportunity": {
          const currentIS = i.current_impression_share || 0;
          const missedPct = 1 - currentIS;
          const currentImpr = i.impressions || 0;
          const totalMarket = currentIS > 0 ? currentImpr / currentIS : 0;
          const missedImpr = totalMarket * missedPct;
          const ctr = i.ctr || (i.clicks && currentImpr ? i.clicks / currentImpr : 0.03);
          const missedClicks = missedImpr * ctr;
          const cr = i.conversion_rate || 0.03;
          const missedConv = missedClicks * cr;
          result = `**Impression Share Opportunity**\n| Metric | Value |\n|---|---|\n| Current IS | ${(currentIS * 100).toFixed(1)}% |\n| Missed Impressions | ${missedImpr.toFixed(0)} |\n| Potential Extra Clicks | ${missedClicks.toFixed(0)} |\n| Potential Extra Conversions | ${missedConv.toFixed(1)} |`;
          break;
        }
      }
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── run_gaql (SECURED — allowlist approach) ─────────────────────────────────

server.tool(
  "run_gaql",
  "Execute a custom GAQL query (read-only). Only SELECT queries are allowed — all write operations are blocked.",
  {
    customer_id: customerIdSchema,
    query: z.string().describe("GAQL SELECT query"),
  },
  async ({ customer_id, query }) => {
    try {
      checkRateLimit("run_gaql");
      const trimmed = query.trim();
      if (!trimmed.toUpperCase().startsWith("SELECT")) {
        return text("Only SELECT queries are allowed. Write operations are blocked for safety.");
      }
      if (!_hasLocalCreds) {
        return text("run_gaql requires local Google Ads credentials (raw GAQL isn't supported via remote). Use the dedicated tools like campaign_performance, search_terms_report, etc. which work with both local and remote backends.");
      }
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const results = await customer.query(trimmed);
      const output =
        results.length === 0
          ? "Query returned no results."
          : `Query returned ${results.length} rows:\n\n\`\`\`json\n${JSON.stringify(results.slice(0, 50), null, 2)}\n\`\`\`${results.length > 50 ? `\n\n(Showing first 50 of ${results.length})` : ""}`;
      return text(output);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── account_health ──────────────────────────────────────────────────────────

server.tool(
  "account_health",
  "Quick health check — anomaly detection for zero conversions, budget limits, quality scores, spend drops.",
  {
    customer_id: customerIdSchema,
  },
  async ({ customer_id }) => {
    try {
      checkRateLimit("account_health");
      const result = await tryLocalThenRemote(
        "account_health", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const [campaigns, keywords] = await Promise.all([
            customer.query(`
              SELECT campaign.name, campaign.status,
                     campaign_budget.has_recommended_budget,
                     metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions
              FROM campaign
              WHERE segments.date DURING LAST_7_DAYS AND campaign.status = 'ENABLED'
              ORDER BY metrics.cost_micros DESC LIMIT 50
            `),
            customer.query(`
              SELECT ad_group_criterion.quality_info.quality_score, metrics.impressions
              FROM keyword_view
              WHERE segments.date DURING LAST_7_DAYS AND ad_group_criterion.status = 'ENABLED' AND metrics.impressions > 10
              LIMIT 200
            `),
          ]);
          const findings = [];
          const zeroConv = campaigns.filter((r) => Number(r.metrics.cost_micros) > 10_000_000 && Number(r.metrics.conversions) === 0);
          if (zeroConv.length > 0) findings.push(`**CRITICAL**: ${zeroConv.length} campaigns spending >$10 with ZERO conversions (7d)`);
          const budgetLimited = campaigns.filter((r) => r.campaign_budget.has_recommended_budget);
          if (budgetLimited.length > 0) findings.push(`**HIGH**: ${budgetLimited.length} campaigns are budget-limited`);
          const lowQS = keywords.filter((r) => Number(r.ad_group_criterion?.quality_info?.quality_score || 10) < 5);
          if (lowQS.length > 0) findings.push(`**MEDIUM**: ${lowQS.length}/${keywords.length} keywords have QS < 5`);
          const totalSpend = campaigns.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
          const totalConv = campaigns.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
          let report = `## Account Health (Last 7 Days)\n\n**${campaigns.length}** campaigns | **${formatMicros(totalSpend)}** spend | **${totalConv.toFixed(0)}** conversions\n\n`;
          report += findings.length === 0
            ? "No major issues detected."
            : `### ${findings.length} Issues\n\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
          return report;
        },
        "account_health",
        {}
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE TOOLS — All require user confirmation via policy engine
// ═══════════════════════════════════════════════════════════════════════════════

const campaignIdSchema = z.string().describe("Campaign ID (numeric, e.g., 123456789)");
const adGroupIdSchema = z.string().describe("Ad group ID (numeric)");

// ─── pause_campaign ──────────────────────────────────────────────────────────

server.tool(
  "pause_campaign",
  "Pause an active campaign. Shows current status before executing. Set dry_run=true to preview without making changes.",
  {
    customer_id: customerIdSchema,
    campaign_id: campaignIdSchema,
    dry_run: z.boolean().optional().default(false).describe("If true, show what would happen without actually pausing."),
    confirm: z.boolean().optional().default(false).describe("Must be true to execute the mutation (safety gate)."),
  },
  async ({ customer_id, campaign_id, dry_run, confirm }) => {
    try {
      checkRateLimit("pause_campaign");
      if (dry_run || !confirm) {
        return text(`**DRY RUN** — would pause campaign \`${campaign_id}\` on account \`${customer_id}\`.\n\nTo execute, call again with \`confirm: true\` and \`dry_run: false\`.`);
      }
      const result = await tryLocalThenRemote(
        "pause_campaign", customer_id,
        async () => {
          const client = getClient();
          const cid = customer_id.replace(/-/g, "");
          const customer = getCustomerForId(client, customer_id);
          const [current] = await customer.query(`
            SELECT campaign.name, campaign.status FROM campaign
            WHERE campaign.id = ${campaign_id} LIMIT 1
          `);
          if (!current) return `Campaign ${campaign_id} not found.`;
          if (current.campaign.status === "PAUSED") return `Campaign "${current.campaign.name}" is already paused.`;
          await customer.mutateResources([{
            entity: "campaign",
            operation: "update",
            resource: { resource_name: `customers/${cid}/campaigns/${campaign_id}`, status: enums.CampaignStatus.PAUSED },
            update_mask: { paths: ["status"] },
          }]);
          return `**Paused** campaign "${current.campaign.name}" (was: ${current.campaign.status})\n\nTo re-enable: use the \`enable_campaign\` tool.`;
        },
        "update_campaign_status",
        { campaign_id, status: "PAUSED" }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── enable_campaign ─────────────────────────────────────────────────────────

server.tool(
  "enable_campaign",
  "Enable a paused campaign. Shows current status before executing. Set dry_run=true to preview without making changes.",
  {
    customer_id: customerIdSchema,
    campaign_id: campaignIdSchema,
    dry_run: z.boolean().optional().default(false).describe("If true, show what would happen without actually enabling."),
    confirm: z.boolean().optional().default(false).describe("Must be true to execute the mutation (safety gate)."),
  },
  async ({ customer_id, campaign_id, dry_run, confirm }) => {
    try {
      checkRateLimit("enable_campaign");
      if (dry_run || !confirm) {
        return text(`**DRY RUN** — would enable campaign \`${campaign_id}\` on account \`${customer_id}\`.\n\nTo execute, call again with \`confirm: true\` and \`dry_run: false\`.`);
      }
      const result = await tryLocalThenRemote(
        "enable_campaign", customer_id,
        async () => {
          const client = getClient();
          const cid = customer_id.replace(/-/g, "");
          const customer = getCustomerForId(client, customer_id);
          const [current] = await customer.query(`
            SELECT campaign.name, campaign.status FROM campaign
            WHERE campaign.id = ${campaign_id} LIMIT 1
          `);
          if (!current) return `Campaign ${campaign_id} not found.`;
          if (current.campaign.status === "ENABLED") return `Campaign "${current.campaign.name}" is already enabled.`;
          await customer.mutateResources([{
            entity: "campaign",
            operation: "update",
            resource: { resource_name: `customers/${cid}/campaigns/${campaign_id}`, status: enums.CampaignStatus.ENABLED },
            update_mask: { paths: ["status"] },
          }]);
          return `**Enabled** campaign "${current.campaign.name}" (was: ${current.campaign.status})`;
        },
        "update_campaign_status",
        { campaign_id, status: "ENABLED" }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── update_bid ──────────────────────────────────────────────────────────────

server.tool(
  "update_bid",
  "Update the CPC bid for an ad group. Shows current bid before changing. Bid is in dollars (e.g., 2.50). Set dry_run=true to preview.",
  {
    customer_id: customerIdSchema,
    ad_group_id: adGroupIdSchema,
    new_bid_dollars: z.number().positive().describe("New CPC bid in dollars (e.g., 2.50)"),
    dry_run: z.boolean().optional().default(false).describe("If true, show what would happen without changing the bid."),
    confirm: z.boolean().optional().default(false).describe("Must be true to execute the mutation (safety gate)."),
  },
  async ({ customer_id, ad_group_id, new_bid_dollars, dry_run, confirm }) => {
    try {
      checkRateLimit("update_bid");
      if (dry_run || !confirm) {
        return text(`**DRY RUN** — would set CPC bid on ad group \`${ad_group_id}\` (account \`${customer_id}\`) to **$${new_bid_dollars.toFixed(2)}**.\n\nTo execute, call again with \`confirm: true\` and \`dry_run: false\`.`);
      }
      const result = await tryLocalThenRemote(
        "update_bid", customer_id,
        async () => {
          const client = getClient();
          const cid = customer_id.replace(/-/g, "");
          const customer = getCustomerForId(client, customer_id);
          const [current] = await customer.query(`
            SELECT ad_group.name, ad_group.cpc_bid_micros, campaign.name
            FROM ad_group WHERE ad_group.id = ${ad_group_id} LIMIT 1
          `);
          if (!current) return `Ad group ${ad_group_id} not found.`;
          const oldBid = formatMicros(current.ad_group.cpc_bid_micros || 0);
          const newBidMicros = Math.round(new_bid_dollars * 1_000_000);
          await customer.mutateResources([{
            entity: "ad_group",
            operation: "update",
            resource: { resource_name: `customers/${cid}/adGroups/${ad_group_id}`, cpc_bid_micros: newBidMicros },
            update_mask: { paths: ["cpc_bid_micros"] },
          }]);
          return `**Updated bid** for ad group "${current.ad_group.name}" (campaign: ${current.campaign.name})\n\n| | Before | After |\n|---|---|---|\n| CPC Bid | ${oldBid} | $${new_bid_dollars.toFixed(2)} |`;
        },
        "update_ad_group_bid",
        { ad_group_id, new_bid_dollars }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── update_budget ───────────────────────────────────────────────────────────

server.tool(
  "update_budget",
  "Update a campaign's daily budget. Shows current budget before changing. Amount is in dollars. Set dry_run=true to preview.",
  {
    customer_id: customerIdSchema,
    campaign_id: campaignIdSchema,
    new_daily_budget_dollars: z.number().positive().describe("New daily budget in dollars (e.g., 50.00)"),
    dry_run: z.boolean().optional().default(false).describe("If true, show what would happen without changing the budget."),
    confirm: z.boolean().optional().default(false).describe("Must be true to execute the mutation (safety gate)."),
  },
  async ({ customer_id, campaign_id, new_daily_budget_dollars, dry_run, confirm }) => {
    try {
      checkRateLimit("update_budget");
      if (dry_run || !confirm) {
        return text(`**DRY RUN** — would set daily budget on campaign \`${campaign_id}\` (account \`${customer_id}\`) to **$${new_daily_budget_dollars.toFixed(2)}/day** (~$${(new_daily_budget_dollars * 30.4).toFixed(2)}/mo).\n\nTo execute, call again with \`confirm: true\` and \`dry_run: false\`.`);
      }

      // Remote path requires budgetId + amountDollars (not campaign_id).
      // We resolve budgetId via a GAQL lookup — works for both local and remote.
      let resolvedBudgetId = null;
      let resolvedCampaignName = null;
      let resolvedOldBudgetMicros = null;

      if (_hasLocalCreds) {
        try {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const [row] = await customer.query(`
            SELECT campaign.name, campaign_budget.amount_micros, campaign_budget.id
            FROM campaign WHERE campaign.id = ${campaign_id} LIMIT 1
          `);
          if (row) {
            resolvedBudgetId = row.campaign_budget?.id;
            resolvedCampaignName = row.campaign?.name;
            resolvedOldBudgetMicros = row.campaign_budget?.amount_micros;
          }
        } catch (e) {
          // fall through to remote-based resolution
        }
      }

      // If local didn't resolve it, ask the remote site to run a GAQL query for us.
      if (!resolvedBudgetId && SITE_CONFIGURED) {
        const cid = customer_id.replace(/-/g, "");
        const q = `SELECT campaign.name, campaign_budget.amount_micros, campaign_budget.id FROM campaign WHERE campaign.id = ${campaign_id} LIMIT 1`;
        const lookup = await callSiteGads("run_gaql", { query: q }, cid);
        const rows = lookup && (lookup.data || lookup.rows || lookup.results);
        const first = Array.isArray(rows) ? rows[0] : null;
        if (first) {
          resolvedBudgetId = first.campaign_budget?.id || first.campaignBudget?.id;
          resolvedCampaignName = first.campaign?.name;
          resolvedOldBudgetMicros = first.campaign_budget?.amount_micros || first.campaignBudget?.amountMicros;
        }
      }

      if (!resolvedBudgetId) {
        return text(`Could not resolve budget for campaign ${campaign_id}. Verify the campaign ID exists under customer ${customer_id}.`);
      }

      const result = await tryLocalThenRemote(
        "update_budget", customer_id,
        async () => {
          const client = getClient();
          const cid = customer_id.replace(/-/g, "");
          const customer = getCustomerForId(client, customer_id);
          const newBudgetMicros = Math.round(new_daily_budget_dollars * 1_000_000);
          await customer.mutateResources([{
            entity: "campaign_budget",
            operation: "update",
            resource: { resource_name: `customers/${cid}/campaignBudgets/${resolvedBudgetId}`, amount_micros: newBudgetMicros },
            update_mask: { paths: ["amount_micros"] },
          }]);
          const oldBudget = formatMicros(resolvedOldBudgetMicros || 0);
          const monthlyEst = `$${(new_daily_budget_dollars * 30.4).toFixed(2)}`;
          return `**Updated budget** for campaign "${resolvedCampaignName || campaign_id}"\n\n| | Before | After |\n|---|---|---|\n| Daily Budget | ${oldBudget} | $${new_daily_budget_dollars.toFixed(2)} |\n| Monthly Est. | — | ${monthlyEst} |`;
        },
        // Remote worker expects opType='budgetOperation' via batch_operations,
        // but the top-level action 'update_budget' also resolves it. Send the
        // shape the worker's budgetOperation branch expects.
        "update_budget",
        { budgetId: resolvedBudgetId, amountDollars: new_daily_budget_dollars }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── add_negative_keywords ───────────────────────────────────────────────────

server.tool(
  "add_negative_keywords",
  "Add negative keywords to a campaign to block unwanted search terms. Provide keywords as a comma-separated list. Set dry_run=true to preview.",
  {
    customer_id: customerIdSchema,
    campaign_id: campaignIdSchema,
    keywords: z.string().describe("Comma-separated negative keywords (e.g., 'free, cheap, diy')"),
    match_type: z.enum(["BROAD", "PHRASE", "EXACT"]).default("BROAD").describe("Match type for the negative keywords"),
    dry_run: z.boolean().optional().default(false).describe("If true, show what would happen without adding the keywords."),
    confirm: z.boolean().optional().default(false).describe("Must be true to execute the mutation (safety gate)."),
  },
  async ({ customer_id, campaign_id, keywords, match_type, dry_run, confirm }) => {
    try {
      checkRateLimit("add_negative_keywords");
      let kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
      const tooLong = kwList.filter((k) => k.length > 80);
      if (tooLong.length) return text(`Negative keywords exceed 80 chars: ${tooLong.slice(0, 3).join(", ")}`);
      kwList = [...new Set(kwList.map((k) => k.toLowerCase()))];
      if (kwList.length === 0) return text("No valid keywords provided after filtering.");
      if (kwList.length > 50) return text("Maximum 50 keywords per call. Please split into batches.");

      if (dry_run || !confirm) {
        const preview = kwList.map((kw) => `  • ${kw} (${match_type})`).join("\n");
        return text(`**DRY RUN** — would add ${kwList.length} negative keywords to campaign \`${campaign_id}\` on account \`${customer_id}\`:\n\n${preview}\n\nTo execute, call again with \`confirm: true\` and \`dry_run: false\`.`);
      }

      const result = await tryLocalThenRemote(
        "add_negative_keywords", customer_id,
        async () => {
          const client = getClient();
          const cid = customer_id.replace(/-/g, "");
          const customer = getCustomerForId(client, customer_id);
          const [current] = await customer.query(`
            SELECT campaign.name FROM campaign WHERE campaign.id = ${campaign_id} LIMIT 1
          `);
          if (!current) return `Campaign ${campaign_id} not found.`;
          const matchTypeEnum = { BROAD: enums.KeywordMatchType.BROAD, PHRASE: enums.KeywordMatchType.PHRASE, EXACT: enums.KeywordMatchType.EXACT }[match_type];
          const operations = kwList.map((kw) => ({
            entity: "campaign_criterion",
            operation: "create",
            resource: { campaign: `customers/${cid}/campaigns/${campaign_id}`, keyword: { text: kw, match_type: matchTypeEnum }, negative: true },
          }));
          await customer.mutateResources(operations);
          const kwTable = kwList.map((kw) => `| ${kw} | ${match_type} | Negative |`).join("\n");
          return `**Added ${kwList.length} negative keywords** to campaign "${current.campaign.name}"\n\n| Keyword | Match Type | Type |\n|---|---|---|\n${kwTable}`;
        },
        "create_negative_keyword",
        { campaign_id, keywords: kwList, match_type }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── create_responsive_search_ad ─────────────────────────────────────────────

server.tool(
  "create_responsive_search_ad",
  "Create a new Responsive Search Ad (RSA) in an ad group. Provide headlines and descriptions. The ad is created PAUSED so you can review before enabling.",
  {
    customer_id: customerIdSchema,
    ad_group_id: adGroupIdSchema,
    final_url: z.string().url().describe("Landing page URL"),
    headlines: z.string().describe("3-15 headlines separated by | (e.g., 'Best Deals | Shop Now | Free Shipping')"),
    descriptions: z.string().describe("2-4 descriptions separated by | (e.g., 'Save 20% on all items today. | Free shipping on orders over $50.')"),
  },
  async ({ customer_id, ad_group_id, final_url, headlines, descriptions }) => {
    try {
      checkRateLimit("create_responsive_search_ad");
      const headlineList = headlines.split("|").map((h) => h.trim()).filter(Boolean);
      const descList = descriptions.split("|").map((d) => d.trim()).filter(Boolean);
      if (headlineList.length < 3) return text("RSAs require at least 3 headlines.");
      if (headlineList.length > 15) return text("RSAs allow a maximum of 15 headlines.");
      if (descList.length < 2) return text("RSAs require at least 2 descriptions.");
      if (descList.length > 4) return text("RSAs allow a maximum of 4 descriptions.");
      const tooLongHeadline = headlineList.find((h) => h.length > 30);
      if (tooLongHeadline) return text(`Headline too long (max 30 chars): "${tooLongHeadline}" (${tooLongHeadline.length} chars)`);
      const tooLongDesc = descList.find((d) => d.length > 90);
      if (tooLongDesc) return text(`Description too long (max 90 chars): "${tooLongDesc}" (${tooLongDesc.length} chars)`);

      const result = await tryLocalThenRemote(
        "create_responsive_search_ad", customer_id,
        async () => {
          const client = getClient();
          const cid = customer_id.replace(/-/g, "");
          const customer = getCustomerForId(client, customer_id);
          const [currentAg] = await customer.query(`
            SELECT ad_group.name, campaign.name FROM ad_group WHERE ad_group.id = ${ad_group_id} LIMIT 1
          `);
          if (!currentAg) return `Ad group ${ad_group_id} not found.`;
          await customer.mutateResources([{
            entity: "ad_group_ad",
            operation: "create",
            resource: {
              ad_group: `customers/${cid}/adGroups/${ad_group_id}`,
              status: enums.AdGroupAdStatus.PAUSED,
              ad: {
                responsive_search_ad: { headlines: headlineList.map((h) => ({ text: h })), descriptions: descList.map((d) => ({ text: d })) },
                final_urls: [final_url],
              },
            },
          }]);
          const headlinePreview = headlineList.map((h, i) => `| ${i + 1} | ${h} | ${h.length}/30 |`).join("\n");
          const descPreview = descList.map((d, i) => `| ${i + 1} | ${d} | ${d.length}/90 |`).join("\n");
          return `**Created RSA** (PAUSED)\n\n**Landing page**: ${final_url}\n\n**Headlines**:\n| # | Text | Length |\n|---|---|---|\n${headlinePreview}\n\n**Descriptions**:\n| # | Text | Length |\n|---|---|---|\n${descPreview}\n\nThe ad was created **paused**. Use the Google Ads UI or enable it when ready.`;
        },
        "create_rsa",
        { ad_group_id, final_url, headlines: headlineList, descriptions: descList }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── apply_recommendation ────────────────────────────────────────────────────

server.tool(
  "apply_recommendation",
  "Apply one of Google's optimization recommendations. Use list_recommendations first to see available ones.",
  {
    customer_id: customerIdSchema,
    recommendation_resource_name: z.string().describe("Full resource name from list_recommendations (e.g., customers/123/recommendations/456)"),
  },
  async ({ customer_id, recommendation_resource_name }) => {
    try {
      checkRateLimit("apply_recommendation");
      if (!_hasLocalCreds) {
        return text("apply_recommendation requires local Google Ads credentials (not available via remote). Please configure local credentials first.");
      }
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const results = await customer.query(`
        SELECT recommendation.type, recommendation.campaign
        FROM recommendation
        WHERE recommendation.resource_name = '${recommendation_resource_name.replace(/'/g, "")}'
        LIMIT 1
      `);
      if (!results || results.length === 0) return text("Recommendation not found. Use `list_recommendations` to get valid resource names.");
      const rec = results[0].recommendation;
      await customer.mutateResources([{
        entity: "recommendation",
        operation: "apply",
        resource: { resource_name: recommendation_resource_name },
      }]);
      return text(`**Applied recommendation**: ${rec.type}\nCampaign: ${rec.campaign || "Account-level"}\n\nThe change is now active in your Google Ads account.`);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── connection_status ───────────────────────────────────────────────────────

server.tool(
  "connection_status",
  "Show which backends are configured — local Google Ads API and/or remote googleadsagent.ai.",
  async () => {
    try {
      const lines = [];
      lines.push("## Connection Status\n");

      if (_hasLocalCreds) {
        const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "not set";
        lines.push(`**Local (google-ads-api)**: Connected — MCC ${loginId}`);
      } else {
        lines.push("**Local (google-ads-api)**: Not configured — run `gemini extensions config google-ads-agent`");
      }

      if (SITE_CONFIGURED) {
        try {
          const accounts = await getSiteAccounts();
          lines.push(`**Remote (${SITE_URL})**: Connected — ${accounts.length} accounts available`);
        } catch (e) {
          lines.push(`**Remote (${SITE_URL})**: Error — ${e.message.slice(0, 100)}`);
        }
      } else {
        lines.push("**Remote (googleadsagent.ai)**: Not configured — set GADS_SITE_URL and GADS_SITE_SESSION_ID");
      }

      lines.push("\n**Routing**: Tools try local first, fall back to remote if the account isn't accessible locally.");
      return text(lines.join("\n"));
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── switch_remote_account ───────────────────────────────────────────────────

server.tool(
  "switch_remote_account",
  "Switch the active account on the remote googleadsagent.ai backend. Use list_accounts to find IDs first.",
  {
    customer_id: customerIdSchema,
  },
  async ({ customer_id }) => {
    try {
      checkRateLimit("switch_remote_account");
      if (!SITE_CONFIGURED) return text("Remote site not configured. Set GADS_SITE_URL and GADS_SITE_SESSION_ID.");
      const cid = customer_id.replace(/-/g, "");
      await switchSiteAccount(cid);
      const creds = await getSiteCreds();
      if (!creds) return text(`Failed to switch to account ${cid} — session may have expired.`);
      return text(`Switched remote backend to account **${cid}**. Ready for queries.`);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENDED TOOLS — Shopping, PMax, Auction, Demographics, etc.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── auction_insights ─────────────────────────────────────────────────────────

server.tool(
  "auction_insights",
  "Competitive auction insights — competitor overlap, impression share, outranking, position above rate. Shows who you're competing against.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    campaign_id: z.string().optional().describe("Optional campaign ID to filter by"),
  },
  async ({ customer_id, date_range, campaign_id }) => {
    try {
      checkRateLimit("auction_insights");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "auction_insights", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const campFilter = campaign_id ? `AND campaign.id = ${campaign_id}` : "";
          const results = await customer.query(`
            SELECT auction_insight.display_domain,
                   metrics.auction_insight_search_impression_share,
                   metrics.auction_insight_search_overlap_rate,
                   metrics.auction_insight_search_position_above_rate,
                   metrics.auction_insight_search_outranking_share,
                   metrics.auction_insight_search_top_impression_percentage
            FROM auction_insight
            WHERE segments.date ${dr.clause} ${campFilter}
            ORDER BY metrics.auction_insight_search_impression_share DESC
            LIMIT 30
          `);
          return fmt(results, (rows) => {
            const header = "| Competitor | Impr Share | Overlap | Pos Above | Outranking | Top % |\n|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.auction_insight.display_domain} | ${formatPercent(m.auction_insight_search_impression_share)} | ${formatPercent(m.auction_insight_search_overlap_rate)} | ${formatPercent(m.auction_insight_search_position_above_rate)} | ${formatPercent(m.auction_insight_search_outranking_share)} | ${formatPercent(m.auction_insight_search_top_impression_percentage)} |`;
            }).join("\n");
            return `Auction Insights (${date_range})\n\n${header}\n${body}`;
          });
        },
        "auction_insights",
        { ...dr.params, campaign_id }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── shopping_performance ─────────────────────────────────────────────────────

server.tool(
  "shopping_performance",
  "Shopping campaign performance — product-level metrics for Shopping and PMax campaigns.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("shopping_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "shopping_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign.name, campaign.advertising_channel_type,
                   shopping_performance_view.resource_name,
                   metrics.clicks, metrics.impressions, metrics.cost_micros,
                   metrics.conversions, metrics.conversions_value
            FROM shopping_performance_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Campaign | Channel | Clicks | Impr | Spend | Conv | Value | ROAS |\n|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              const roas = Number(m.cost_micros) > 0 ? (Number(m.conversions_value || 0) / (Number(m.cost_micros) / 1e6)).toFixed(2) : "—";
              return `| ${r.campaign.name} | ${r.campaign.advertising_channel_type} | ${m.clicks} | ${m.impressions} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} | ${roas}x |`;
            }).join("\n");
            return `Shopping Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "shopping_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── product_group_performance ────────────────────────────────────────────────

server.tool(
  "product_group_performance",
  "Product group performance in Shopping campaigns — category and product-level metrics.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("product_group_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "product_group_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign.name, ad_group.name,
                   ad_group_criterion.listing_group.type,
                   metrics.clicks, metrics.impressions, metrics.cost_micros,
                   metrics.conversions, metrics.conversions_value
            FROM product_group_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC
            LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Campaign | Ad Group | Type | Clicks | Spend | Conv | Value |\n|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.campaign.name} | ${r.ad_group.name} | ${r.ad_group_criterion?.listing_group?.type || "—"} | ${m.clicks} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `Product Group Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "product_group_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── pmax_performance ─────────────────────────────────────────────────────────

server.tool(
  "pmax_performance",
  "Performance Max campaign analysis — asset group performance, listing groups, and search themes.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    report_type: z.enum(["asset_groups", "listing_groups"]).default("asset_groups"),
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, report_type, limit }) => {
    try {
      checkRateLimit("pmax_performance");
      const dr = parseDateRange(date_range);
      const siteAction = report_type === "listing_groups" ? "pmax_listing_groups" : "pmax_asset_performance";
      const result = await tryLocalThenRemote(
        "pmax_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          if (report_type === "listing_groups") {
            const results = await customer.query(`
              SELECT campaign.name, asset_group.name,
                     asset_group_listing_group_filter.type,
                     metrics.clicks, metrics.impressions, metrics.cost_micros,
                     metrics.conversions
              FROM asset_group_listing_group_filter
              WHERE segments.date ${dr.clause}
              ORDER BY metrics.cost_micros DESC LIMIT ${limit}
            `);
            return fmt(results, (rows) => JSON.stringify(rows.slice(0, 30), null, 2));
          }
          const results = await customer.query(`
            SELECT campaign.name, asset_group.name, asset_group.status,
                   asset_group.ad_strength,
                   metrics.clicks, metrics.impressions, metrics.cost_micros,
                   metrics.conversions, metrics.conversions_value
            FROM asset_group
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Campaign | Asset Group | Status | Strength | Clicks | Spend | Conv | Value |\n|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.campaign.name} | ${r.asset_group.name} | ${labelStatus(r.asset_group.status)} | ${labelAdStrength(r.asset_group.ad_strength)} | ${m.clicks} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `PMax Asset Groups (${date_range})\n\n${header}\n${body}`;
          });
        },
        siteAction,
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── conversion_tracking ──────────────────────────────────────────────────────

server.tool(
  "conversion_tracking",
  "Conversion actions and goals — shows all conversion actions, their types, status, and attribution settings.",
  {
    customer_id: customerIdSchema,
    detail: z.boolean().default(false).describe("If true, shows detailed conversion action config"),
  },
  async ({ customer_id, detail }) => {
    try {
      checkRateLimit("conversion_tracking");
      const siteAction = detail ? "conversion_action_detail" : "list_conversions";
      const result = await tryLocalThenRemote(
        "conversion_tracking", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT conversion_action.id, conversion_action.name,
                   conversion_action.type, conversion_action.status,
                   conversion_action.category,
                   conversion_action.primary_for_goal,
                   conversion_action.counting_type,
                   conversion_action.attribution_model_settings.attribution_model,
                   conversion_action.value_settings.default_value,
                   metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion
            FROM conversion_action
            ORDER BY metrics.conversions DESC
          `);
          return fmt(results, (rows) => {
            const header = "| Name | Type | Status | Primary | Category | Model | Conversions | Value |\n|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const ca = r.conversion_action;
              const m = r.metrics || {};
              return `| ${ca.name} | ${ca.type} | ${ca.status} | ${ca.primary_for_goal ? "Yes" : "No"} | ${ca.category || "—"} | ${ca.attribution_model_settings?.attribution_model || "—"} | ${Number(m.conversions || 0).toFixed(0)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `Conversion Actions — ${rows.length} total\n\n${header}\n${body}`;
          });
        },
        siteAction,
        {}
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── ad_group_performance ─────────────────────────────────────────────────────

server.tool(
  "ad_group_performance",
  "Ad group level performance — spend, conversions, CTR by ad group.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    campaign_id: z.string().optional().describe("Filter by campaign ID"),
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, campaign_id, limit }) => {
    try {
      checkRateLimit("ad_group_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "ad_group_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const campFilter = campaign_id ? `AND campaign.id = ${campaign_id}` : "";
          const results = await customer.query(`
            SELECT ad_group.id, ad_group.name, ad_group.status,
                   campaign.name, metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value, metrics.clicks, metrics.impressions,
                   metrics.ctr, metrics.cost_per_conversion
            FROM ad_group
            WHERE segments.date ${dr.clause} AND ad_group.status != 'REMOVED' ${campFilter}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Ad Group | Campaign | Status | Spend | Conv | Clicks | CTR | CPA |\n|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.ad_group.name} | ${r.campaign.name} | ${labelStatus(r.ad_group.status)} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | ${m.clicks} | ${safeCtr(m.clicks, m.impressions)} | ${safeCpa(m.cost_micros, m.conversions)} |`;
            }).join("\n");
            return `Ad Group Performance (${date_range}) — ${rows.length} ad groups\n\n${header}\n${body}`;
          });
        },
        "list_ad_groups",
        { ...dr.params, campaign_id, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── keyword_performance ──────────────────────────────────────────────────────

server.tool(
  "keyword_performance",
  "Keyword level performance — spend, conversions, quality score by keyword.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    campaign_id: z.string().optional(),
    limit: limitSchema.default(50),
  },
  async ({ customer_id, date_range, campaign_id, limit }) => {
    try {
      checkRateLimit("keyword_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "keyword_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const campFilter = campaign_id ? `AND campaign.id = ${campaign_id}` : "";
          const results = await customer.query(`
            SELECT ad_group_criterion.keyword.text,
                   ad_group_criterion.keyword.match_type,
                   ad_group_criterion.quality_info.quality_score,
                   campaign.name, ad_group.name,
                   metrics.cost_micros, metrics.conversions, metrics.clicks,
                   metrics.impressions, metrics.ctr, metrics.cost_per_conversion
            FROM keyword_view
            WHERE segments.date ${dr.clause} AND ad_group_criterion.status = 'ENABLED' ${campFilter}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Keyword | Match | QS | Campaign | Clicks | Spend | Conv | CPA |\n|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const kw = r.ad_group_criterion;
              const m = r.metrics;
              return `| ${kw.keyword.text} | ${labelMatchType(kw.keyword.match_type)} | ${kw.quality_info?.quality_score ?? "—"} | ${r.campaign.name} | ${m.clicks} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | ${safeCpa(m.cost_micros, m.conversions)} |`;
            }).join("\n");
            return `Keyword Performance (${date_range}) — ${rows.length} keywords\n\n${header}\n${body}`;
          });
        },
        "list_keywords",
        { ...dr.params, campaign_id, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── wasted_spend ─────────────────────────────────────────────────────────────

server.tool(
  "wasted_spend",
  "Wasted spend analysis — search terms, keywords, and campaigns spending with zero conversions.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(50),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("wasted_spend");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "wasted_spend", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT search_term_view.search_term, campaign.name,
                   metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
            FROM search_term_view
            WHERE segments.date ${dr.clause} AND metrics.conversions = 0 AND metrics.cost_micros > 0
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const totalWaste = rows.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
            const header = "| Search Term | Campaign | Clicks | Spend | Conv |\n|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.search_term_view.search_term} | ${r.campaign.name} | ${m.clicks} | ${formatMicros(m.cost_micros)} | 0 |`;
            }).join("\n");
            return `Wasted Spend (${date_range}) — ${formatMicros(totalWaste)} wasted across ${rows.length} zero-conversion search terms\n\n${header}\n${body}`;
          });
        },
        "wasted_spend",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── daily_performance ────────────────────────────────────────────────────────

server.tool(
  "daily_performance",
  "Daily performance breakdown — trend data by date for spend, conversions, ROAS.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    campaign_id: z.string().optional(),
  },
  async ({ customer_id, date_range, campaign_id }) => {
    try {
      checkRateLimit("daily_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "daily_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const campFilter = campaign_id ? `AND campaign.id = ${campaign_id}` : "";
          const results = await customer.query(`
            SELECT segments.date, metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value, metrics.clicks, metrics.impressions
            FROM campaign
            WHERE segments.date ${dr.clause} AND campaign.status = 'ENABLED' ${campFilter}
            ORDER BY segments.date ASC
          `);
          const byDate = {};
          for (const r of results) {
            const d = r.segments.date;
            if (!byDate[d]) byDate[d] = { spend: 0, conv: 0, value: 0, clicks: 0, impr: 0 };
            byDate[d].spend += Number(r.metrics.cost_micros || 0);
            byDate[d].conv += Number(r.metrics.conversions || 0);
            byDate[d].value += Number(r.metrics.conversions_value || 0);
            byDate[d].clicks += Number(r.metrics.clicks || 0);
            byDate[d].impr += Number(r.metrics.impressions || 0);
          }
          const header = "| Date | Spend | Conv | Value | ROAS | Clicks | Impr |\n|---|---|---|---|---|---|---|";
          const body = Object.entries(byDate).map(([date, d]) => {
            const roas = d.spend > 0 ? (d.value / (d.spend / 1e6)).toFixed(2) : "—";
            return `| ${date} | ${formatMicros(d.spend)} | ${d.conv.toFixed(1)} | $${d.value.toFixed(2)} | ${roas}x | ${d.clicks} | ${d.impr} |`;
          }).join("\n");
          return `Daily Performance (${date_range}) — ${Object.keys(byDate).length} days\n\n${header}\n${body}`;
        },
        "daily_performance",
        { ...dr.params, campaign_id }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── age_gender_performance ───────────────────────────────────────────────────

server.tool(
  "demographics_performance",
  "Demographics breakdown — age, gender, parental status, and household income performance.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    dimension: z.enum(["age", "gender", "parental_status", "income"]).default("age"),
  },
  async ({ customer_id, date_range, dimension }) => {
    try {
      checkRateLimit("demographics_performance");
      const dr = parseDateRange(date_range);
      const actionMap = { age: "age_performance", gender: "gender_performance", parental_status: "parental_status_performance", income: "income_performance" };
      const viewMap = { age: "age_range_view", gender: "gender_view", parental_status: "parental_status_view", income: "income_range_view" };
      const segMap = { age: "ad_group_criterion.age_range.type", gender: "ad_group_criterion.gender.type", parental_status: "ad_group_criterion.parental_status.type", income: "ad_group_criterion.income_range.type" };
      const result = await tryLocalThenRemote(
        "demographics_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT ${segMap[dimension]}, campaign.name,
                   metrics.cost_micros, metrics.conversions, metrics.clicks,
                   metrics.impressions, metrics.conversions_value
            FROM ${viewMap[dimension]}
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC LIMIT 50
          `);
          return fmt(results, (rows) => JSON.stringify(rows.slice(0, 30), null, 2));
        },
        actionMap[dimension],
        { ...dr.params }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── placement_performance ────────────────────────────────────────────────────

server.tool(
  "placement_performance",
  "Display/Video placement performance — where ads are showing (websites, apps, YouTube channels).",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("placement_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "placement_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT detail_placement_view.display_name,
                   detail_placement_view.target_url,
                   detail_placement_view.placement_type,
                   campaign.name,
                   metrics.clicks, metrics.impressions, metrics.cost_micros,
                   metrics.conversions
            FROM detail_placement_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Placement | Type | Campaign | Clicks | Impr | Spend | Conv |\n|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const p = r.detail_placement_view;
              const m = r.metrics;
              return `| ${p.display_name || p.target_url || "—"} | ${p.placement_type || "—"} | ${r.campaign.name} | ${m.clicks} | ${m.impressions} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} |`;
            }).join("\n");
            return `Placement Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "placement_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── video_performance ────────────────────────────────────────────────────────

server.tool(
  "video_performance",
  "Video/YouTube campaign performance — views, view rate, CPV, conversions for video campaigns.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(20),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("video_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "video_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign.name, campaign.id,
                   metrics.video_views, metrics.video_view_rate,
                   metrics.average_cpv, metrics.cost_micros,
                   metrics.conversions, metrics.clicks, metrics.impressions
            FROM campaign
            WHERE segments.date ${dr.clause}
              AND campaign.advertising_channel_type = 'VIDEO'
              AND campaign.status = 'ENABLED'
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Campaign | Views | View Rate | CPV | Spend | Conv | Clicks |\n|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.campaign.name} | ${m.video_views || 0} | ${formatPercent(m.video_view_rate)} | ${formatMicros(m.average_cpv)} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | ${m.clicks} |`;
            }).join("\n");
            return `Video Campaign Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "video_campaign_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── display_performance ──────────────────────────────────────────────────────

server.tool(
  "display_performance",
  "Display network campaign performance — spend, conversions, viewability, CPM for Display campaigns only.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("display_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "display_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign.name, campaign.id, campaign.status,
                   metrics.impressions, metrics.clicks, metrics.ctr,
                   metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value, metrics.average_cpm
            FROM campaign
            WHERE segments.date ${dr.clause}
              AND campaign.advertising_channel_type = 'DISPLAY'
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            if (!rows.length) return `No Display campaigns with spend in ${date_range}.`;
            const header = "| Campaign | Status | Impr | Clicks | CTR | CPM | Spend | Conv | Value |\n|---|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.campaign.name} | ${labelStatus(r.campaign.status)} | ${m.impressions || 0} | ${m.clicks || 0} | ${formatPercent(m.ctr)} | ${formatMicros(m.average_cpm)} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `Display Campaign Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "list_campaigns",
        { ...dr.params, limit, advertising_channel_type: "DISPLAY" }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── demand_gen_performance ───────────────────────────────────────────────────

server.tool(
  "demand_gen_performance",
  "Demand Gen (formerly Discovery) campaign performance — spend, conversions, view-through, engagement.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("demand_gen_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "demand_gen_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          // DEMAND_GEN replaces the older DISCOVERY channel; query both for compatibility.
          const results = await customer.query(`
            SELECT campaign.name, campaign.id, campaign.status,
                   campaign.advertising_channel_type,
                   metrics.impressions, metrics.clicks, metrics.ctr,
                   metrics.cost_micros, metrics.conversions,
                   metrics.conversions_value
            FROM campaign
            WHERE segments.date ${dr.clause}
              AND campaign.advertising_channel_type IN ('DEMAND_GEN', 'DISCOVERY')
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            if (!rows.length) return `No Demand Gen / Discovery campaigns with spend in ${date_range}.`;
            const header = "| Campaign | Channel | Status | Impr | Clicks | CTR | Spend | Conv | Value |\n|---|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${r.campaign.name} | ${r.campaign.advertising_channel_type} | ${labelStatus(r.campaign.status)} | ${m.impressions || 0} | ${m.clicks || 0} | ${formatPercent(m.ctr)} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `Demand Gen / Discovery Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "run_gaql",
        {
          query: `SELECT campaign.name, campaign.id, campaign.status, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date ${dr.clause} AND campaign.advertising_channel_type IN ('DEMAND_GEN', 'DISCOVERY') ORDER BY metrics.cost_micros DESC LIMIT ${limit}`,
        }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── enhanced_conversions_status ──────────────────────────────────────────────

server.tool(
  "enhanced_conversions_status",
  "Enhanced Conversions diagnostic — shows which conversion actions have enhanced conversions enabled, user-provided data status, and hashed-match reporting.",
  {
    customer_id: customerIdSchema,
    limit: limitSchema.default(50),
  },
  async ({ customer_id, limit }) => {
    try {
      checkRateLimit("enhanced_conversions_status");
      const result = await tryLocalThenRemote(
        "enhanced_conversions_status", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const rows = await customer.query(`
            SELECT conversion_action.name, conversion_action.id,
                   conversion_action.status, conversion_action.type,
                   conversion_action.category,
                   conversion_action.include_in_conversions_metric,
                   conversion_action.click_through_lookback_window_days,
                   conversion_action.view_through_lookback_window_days,
                   conversion_action.attribution_model_settings.attribution_model
            FROM conversion_action
            WHERE conversion_action.status != 'REMOVED'
            ORDER BY conversion_action.name LIMIT ${limit}
          `);
          return fmt(rows, (data) => {
            if (!data.length) return "No conversion actions found.";
            const header = "| Name | Type | Category | Status | Include? | CT Window | VT Window | Attribution |\n|---|---|---|---|---|---|---|---|";
            const body = data.map((r) => {
              const ca = r.conversion_action;
              const attr = ca.attribution_model_settings?.attribution_model || 'DEFAULT';
              return `| ${ca.name} | ${ca.type} | ${ca.category} | ${ca.status} | ${ca.include_in_conversions_metric ? '✓' : '✗'} | ${ca.click_through_lookback_window_days || 30}d | ${ca.view_through_lookback_window_days || 1}d | ${attr} |`;
            }).join("\n");
            return `Enhanced Conversions Status — ${data.length} action(s)\n\n${header}\n${body}\n\n_Note: this reports conversion action configuration. To verify enhanced-conversions upload health (hash match rate), check \`Tools → Conversions → Diagnostics\` in the UI; the API does not expose match rate directly._`;
          });
        },
        "run_gaql",
        {
          query: `SELECT conversion_action.name, conversion_action.id, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.include_in_conversions_metric FROM conversion_action WHERE conversion_action.status != 'REMOVED' ORDER BY conversion_action.name LIMIT ${limit}`,
        }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── customer_match_lists ─────────────────────────────────────────────────────

server.tool(
  "customer_match_lists",
  "Customer Match audience lists — shows CRM, email, and uploaded user lists, their size status, and match rates.",
  {
    customer_id: customerIdSchema,
    limit: limitSchema.default(50),
  },
  async ({ customer_id, limit }) => {
    try {
      checkRateLimit("customer_match_lists");
      const result = await tryLocalThenRemote(
        "customer_match_lists", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const rows = await customer.query(`
            SELECT user_list.name, user_list.id, user_list.type,
                   user_list.size_for_display, user_list.size_for_search,
                   user_list.size_range_for_display, user_list.size_range_for_search,
                   user_list.membership_status, user_list.membership_life_span,
                   user_list.description
            FROM user_list
            WHERE user_list.type IN ('CRM_BASED', 'RULE_BASED', 'LOGICAL', 'SIMILAR')
              AND user_list.membership_status = 'OPEN'
            ORDER BY user_list.size_for_display DESC LIMIT ${limit}
          `);
          return fmt(rows, (data) => {
            if (!data.length) return "No active user lists found. Customer Match may not be enabled for this account.";
            const header = "| List | Type | Status | Display Size | Search Size | Lifespan |\n|---|---|---|---|---|---|";
            const body = data.map((r) => {
              const ul = r.user_list;
              return `| ${ul.name} | ${ul.type} | ${ul.membership_status} | ${ul.size_for_display || 0} | ${ul.size_for_search || 0} | ${ul.membership_life_span || 540}d |`;
            }).join("\n");
            return `Customer Match / User Lists (${data.length})\n\n${header}\n${body}`;
          });
        },
        "list_user_lists",
        { limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── merchant_center_diagnostics ──────────────────────────────────────────────

server.tool(
  "merchant_center_diagnostics",
  "Merchant Center feed health — product offer count, disapproval rate, Shopping-campaign product coverage, and top disapproval reasons.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(50),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("merchant_center_diagnostics");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "merchant_center_diagnostics", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          // Shopping-performance is the closest public-API lens into MC health from the Ads side.
          // Full feed-level disapproval data lives in the Content API (Merchant Center).
          const rows = await customer.query(`
            SELECT segments.product_item_id, segments.product_title,
                   segments.product_brand, segments.product_condition,
                   metrics.impressions, metrics.clicks, metrics.cost_micros,
                   metrics.conversions, metrics.conversions_value
            FROM shopping_performance_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(rows, (data) => {
            if (!data.length) {
              return `No Shopping/PMax product performance in ${date_range}. This could mean:\n  • No Shopping or PMax-with-feed campaigns are active\n  • Merchant Center is not linked\n  • No products are approved in the feed\n\nCheck Merchant Center directly at https://merchants.google.com for full feed diagnostics.`;
            }
            const totalSpend = data.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
            const totalConv = data.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
            const zeroConv = data.filter((r) => Number(r.metrics.conversions) === 0 && Number(r.metrics.cost_micros) > 0).length;
            const header = "| Product | Brand | Impr | Clicks | Spend | Conv | Value |\n|---|---|---|---|---|---|---|";
            const body = data.slice(0, 20).map((r) => {
              const s = r.segments, m = r.metrics;
              return `| ${(s.product_title || s.product_item_id || '?').substring(0, 50)} | ${s.product_brand || '—'} | ${m.impressions || 0} | ${m.clicks || 0} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `Merchant Center / Shopping Diagnostics (${date_range})\n\n**Totals (top ${data.length} SKUs):** ${formatMicros(totalSpend)} spend · ${totalConv.toFixed(1)} conv · ${zeroConv} zero-conv SKUs\n\n${header}\n${body}\n\n_For full feed approval/disapproval status, use the Content API at https://shoppingcontent.googleapis.com._`;
          });
        },
        "shopping_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── landing_page_report ──────────────────────────────────────────────────────

server.tool(
  "landing_page_report",
  "Landing page performance — URL-level metrics to identify high and low performing pages.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("landing_page_report");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "landing_page_report", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT landing_page_view.unexpanded_final_url,
                   metrics.clicks, metrics.impressions, metrics.cost_micros,
                   metrics.conversions, metrics.conversions_value,
                   metrics.mobile_friendly_clicks_percentage,
                   metrics.speed_score
            FROM landing_page_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => {
            const header = "| Landing Page | Clicks | Spend | Conv | Value | Mobile % | Speed |\n|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const m = r.metrics;
              return `| ${(r.landing_page_view.unexpanded_final_url || "—").slice(0, 60)} | ${m.clicks} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} | ${m.mobile_friendly_clicks_percentage || "—"} | ${m.speed_score || "—"} |`;
            }).join("\n");
            return `Landing Page Performance (${date_range})\n\n${header}\n${body}`;
          });
        },
        "landing_page_performance",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── bidding_strategies ───────────────────────────────────────────────────────

server.tool(
  "bidding_strategies",
  "Bidding strategy details — portfolio and campaign-level strategies with targets and performance.",
  {
    customer_id: customerIdSchema,
  },
  async ({ customer_id }) => {
    try {
      checkRateLimit("bidding_strategies");
      const result = await tryLocalThenRemote(
        "bidding_strategies", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT bidding_strategy.id, bidding_strategy.name,
                   bidding_strategy.type, bidding_strategy.status,
                   bidding_strategy.campaign_count,
                   bidding_strategy.target_roas.target_roas,
                   bidding_strategy.target_cpa.target_cpa_micros,
                   metrics.cost_micros, metrics.conversions, metrics.conversions_value
            FROM bidding_strategy
            ORDER BY metrics.cost_micros DESC
          `);
          return fmt(results, (rows) => {
            const header = "| Strategy | Type | Status | Campaigns | Target | Spend | Conv | Value |\n|---|---|---|---|---|---|---|---|";
            const body = rows.map((r) => {
              const bs = r.bidding_strategy;
              const m = r.metrics || {};
              let target = "—";
              if (bs.target_roas?.target_roas) target = `tROAS ${(bs.target_roas.target_roas * 100).toFixed(0)}%`;
              if (bs.target_cpa?.target_cpa_micros) target = `tCPA ${formatMicros(bs.target_cpa.target_cpa_micros)}`;
              return `| ${bs.name} | ${bs.type} | ${bs.status} | ${bs.campaign_count || "—"} | ${target} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions || 0).toFixed(1)} | $${Number(m.conversions_value || 0).toFixed(2)} |`;
            }).join("\n");
            return `Bidding Strategies — ${rows.length} total\n\n${header}\n${body}`;
          });
        },
        "list_bidding_strategies",
        {}
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── audience_performance ─────────────────────────────────────────────────────

server.tool(
  "audience_performance",
  "Audience segment performance — shows how different audiences perform with spend, conversions, ROAS.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
    limit: limitSchema.default(30),
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("audience_performance");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "audience_performance", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT campaign_audience_view.resource_name, campaign.name,
                   metrics.cost_micros, metrics.conversions, metrics.conversions_value,
                   metrics.clicks, metrics.impressions
            FROM campaign_audience_view
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.cost_micros DESC LIMIT ${limit}
          `);
          return fmt(results, (rows) => JSON.stringify(rows.slice(0, 30), null, 2));
        },
        "list_audiences",
        { ...dr.params, limit }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── ad_extensions ────────────────────────────────────────────────────────────

server.tool(
  "ad_extensions",
  "Ad extensions/assets — sitelinks, callouts, structured snippets, images, and their performance.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
  },
  async ({ customer_id, date_range }) => {
    try {
      checkRateLimit("ad_extensions");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "ad_extensions", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT asset.name, asset.type, asset.final_urls,
                   campaign.name,
                   metrics.clicks, metrics.impressions, metrics.cost_micros
            FROM campaign_asset
            WHERE segments.date ${dr.clause}
            ORDER BY metrics.clicks DESC LIMIT 50
          `);
          return fmt(results, (rows) => JSON.stringify(rows.slice(0, 30), null, 2));
        },
        "list_extensions",
        { ...dr.params }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── ad_schedule_report ───────────────────────────────────────────────────────

server.tool(
  "ad_schedule_report",
  "Ad schedule / day-of-week / hour-of-day performance — shows when ads perform best.",
  {
    customer_id: customerIdSchema,
    date_range: dateRangeSchema,
  },
  async ({ customer_id, date_range }) => {
    try {
      checkRateLimit("ad_schedule_report");
      const dr = parseDateRange(date_range);
      const result = await tryLocalThenRemote(
        "ad_schedule_report", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT segments.day_of_week, segments.hour,
                   metrics.cost_micros, metrics.conversions, metrics.clicks,
                   metrics.impressions
            FROM campaign
            WHERE segments.date ${dr.clause} AND campaign.status = 'ENABLED'
          `);
          const byDayHour = {};
          for (const r of results) {
            const key = `${r.segments.day_of_week}-${r.segments.hour}`;
            if (!byDayHour[key]) byDayHour[key] = { day: r.segments.day_of_week, hour: r.segments.hour, spend: 0, conv: 0, clicks: 0 };
            byDayHour[key].spend += Number(r.metrics.cost_micros || 0);
            byDayHour[key].conv += Number(r.metrics.conversions || 0);
            byDayHour[key].clicks += Number(r.metrics.clicks || 0);
          }
          const sorted = Object.values(byDayHour).sort((a, b) => b.spend - a.spend);
          const header = "| Day | Hour | Spend | Conv | Clicks | CPA |\n|---|---|---|---|---|---|";
          const body = sorted.slice(0, 50).map((d) =>
            `| ${d.day} | ${d.hour}:00 | ${formatMicros(d.spend)} | ${d.conv.toFixed(1)} | ${d.clicks} | ${d.conv > 0 ? formatMicros(d.spend / d.conv) : "—"} |`
          ).join("\n");
          return `Ad Schedule Performance (${date_range}) — ${sorted.length} day-hour combos\n\n${header}\n${body}`;
        },
        "ad_schedule_performance",
        { ...dr.params }
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── account_settings ─────────────────────────────────────────────────────────

server.tool(
  "account_settings",
  "Account settings and configuration — currency, timezone, tracking template, auto-tagging, conversion goals.",
  {
    customer_id: customerIdSchema,
  },
  async ({ customer_id }) => {
    try {
      checkRateLimit("account_settings");
      const result = await tryLocalThenRemote(
        "account_settings", customer_id,
        async () => {
          const client = getClient();
          const customer = getCustomerForId(client, customer_id);
          const results = await customer.query(`
            SELECT customer.id, customer.descriptive_name,
                   customer.currency_code, customer.time_zone,
                   customer.tracking_url_template,
                   customer.auto_tagging_enabled,
                   customer.optimization_score,
                   customer.manager,
                   customer.status
            FROM customer LIMIT 1
          `);
          if (!results || results.length === 0) return "Could not retrieve account settings.";
          const c = results[0].customer;
          return `## Account Settings\n\n| Setting | Value |\n|---|---|\n| ID | ${c.id} |\n| Name | ${c.descriptive_name} |\n| Currency | ${c.currency_code} |\n| Timezone | ${c.time_zone} |\n| Auto-tagging | ${c.auto_tagging_enabled ? "Yes" : "No"} |\n| Tracking Template | ${c.tracking_url_template || "None"} |\n| Optimization Score | ${c.optimization_score ? (c.optimization_score * 100).toFixed(1) + "%" : "—"} |\n| Manager | ${c.manager ? "Yes" : "No"} |\n| Status | ${c.status} |`;
        },
        "account_summary",
        {}
      );
      return text(result);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── run_remote_query (catch-all for any remote action) ───────────────────────

server.tool(
  "run_remote_query",
  "Execute any query on the remote googleadsagent.ai backend. Use this for actions not covered by dedicated tools. Valid actions: account_summary, campaign_count, list_campaigns, list_ad_groups, list_keywords, list_search_terms, wasted_spend, list_ads, list_budgets, geo_performance, device_performance, change_history, list_recommendations, list_conversions, list_audiences, list_asset_groups, list_bidding_strategies, list_labels, list_negative_keyword_lists, list_extensions, ad_schedule_performance, list_experiments, landing_page_performance, quality_score_report, impression_share, daily_performance, campaign_daily, hourly_performance, age_performance, gender_performance, auction_insights, video_campaign_performance, video_ad_performance, shopping_performance, product_group_performance, pmax_asset_performance, pmax_listing_groups, placement_performance, topic_performance, ad_group_audience_performance, list_user_lists, parental_status_performance, income_performance, list_campaign_criteria, shared_budget_detail, conversion_action_detail.",
  {
    customer_id: customerIdSchema,
    action: z.string().describe("The remote API action to execute"),
    date_range: dateRangeSchema.optional(),
    limit: z.number().optional(),
    campaign_id: z.string().optional(),
    extra_params: z.record(z.any()).optional().describe("Additional parameters as key-value pairs"),
  },
  async ({ customer_id, action, date_range, limit, campaign_id, extra_params }) => {
    try {
      checkRateLimit("run_remote_query");
      if (!SITE_CONFIGURED) return text("Remote site not configured. Set GADS_SITE_URL and GADS_SITE_SESSION_ID.");
      const dr = date_range ? parseDateRange(date_range) : { params: {} };
      const cid = customer_id.replace(/-/g, "");
      const params = { ...dr.params, ...extra_params };
      if (limit) params.limit = limit;
      if (campaign_id) params.campaign_id = campaign_id;
      const result = await callSiteGads(action, params, cid);
      if (result && result.error) {
        const errMsg = typeof result.error === "string" ? result.error : extractErrorMessage(result.error);
        if (errMsg.toLowerCase().includes("requested_metrics_for_manager")) {
          return text("This is a Manager (MCC) account — metrics can't be queried directly. Use `list_sub_accounts` to find leaf accounts, then query those.");
        }
        return text(`Remote error: ${errMsg}`);
      }
      return text(formatSiteResult(result));
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── Connect ─────────────────────────────────────────────────────────────────

if (SITE_CONFIGURED) {
  console.error(`[google-ads-agent] Remote site configured: ${SITE_URL}`);
}
if (_hasLocalCreds) {
  console.error(`[google-ads-agent] Local credentials configured (MCC: ${process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "?"})`);
}

const transport = new StdioServerTransport();
await server.connect(transport);
