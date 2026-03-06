import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleAdsApi } from "google-ads-api";

const server = new McpServer({
  name: "google-ads-agent",
  version: "2.1.0",
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

function safeError(e) {
  if (e instanceof RateLimitError) return e.message;
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("missing google ads credentials")) return e.message;
  if (msg.includes("unauthenticated") || msg.includes("authentication"))
    return "Authentication failed. Run: gemini extensions config google-ads-agent";
  if (msg.includes("permission_denied"))
    return "Permission denied. Verify this account is accessible under your MCC.";
  if (msg.includes("resource_not_found"))
    return "Resource not found. Check the customer ID.";
  if (msg.includes("quota") || msg.includes("rate"))
    return "Google Ads API rate limit hit. Wait a few seconds and retry.";
  if (msg.includes("invalid_customer_id"))
    return "Invalid customer ID format. Use a 10-digit ID (e.g., 1234567890).";
  console.error("[google-ads-agent]", e);
  return "An unexpected error occurred. Check that your credentials and customer ID are correct.";
}

// ─── Client Setup ────────────────────────────────────────────────────────────

function getClient() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google Ads credentials. Run: gemini extensions config google-ads-agent"
    );
  }

  return new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
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

// ─── Shared Schemas ──────────────────────────────────────────────────────────

const customerIdSchema = z
  .string()
  .regex(/^\d{3}-?\d{3}-?\d{4}$/, "Must be a 10-digit customer ID (e.g., 1234567890 or 123-456-7890)")
  .describe("Google Ads customer ID (10 digits)");

const dateRangeSchema = z
  .enum([
    "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS",
    "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "LAST_MONTH",
  ])
  .default("LAST_30_DAYS")
  .describe("Date range for the report");

const limitSchema = z.number().min(1).max(200).default(50);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMicros(micros) {
  return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function text(str) {
  return { content: [{ type: "text", text: str }] };
}

function fmt(rows, formatFn) {
  if (!rows || rows.length === 0) return "No data found.";
  return formatFn(rows);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── list_accounts ───────────────────────────────────────────────────────────

server.tool(
  "list_accounts",
  {
    description:
      "List all Google Ads accounts accessible under the configured MCC.",
  },
  async () => {
    try {
      checkRateLimit("list_accounts");
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
      return text(
        fmt(results, (rows) => {
          const header =
            "| Account ID | Name | Manager | Currency |\n|---|---|---|---|";
          const body = rows
            .map((r) => {
              const c = r.customer_client;
              return `| ${c.id} | ${c.descriptive_name} | ${c.manager ? "Yes" : "No"} | ${c.currency_code} |`;
            })
            .join("\n");
          return `Found ${rows.length} accounts:\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── campaign_performance ────────────────────────────────────────────────────

server.tool(
  "campaign_performance",
  {
    description:
      "Campaign performance metrics — spend, conversions, clicks, impressions, CTR, CPC, CPA.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
      status: z.enum(["ENABLED", "PAUSED", "ALL"]).default("ENABLED"),
      limit: limitSchema.default(20),
    },
  },
  async ({ customer_id, date_range, status, limit }) => {
    try {
      checkRateLimit("campaign_performance");
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const statusClause =
        status === "ALL" ? "" : `AND campaign.status = '${status}'`;
      const results = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status,
               campaign.bidding_strategy_type,
               metrics.cost_micros, metrics.conversions,
               metrics.conversions_value, metrics.clicks,
               metrics.impressions, metrics.ctr, metrics.average_cpc,
               metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date DURING ${date_range} ${statusClause}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
          const totalSpend = rows.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
          const totalConv = rows.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
          const header =
            "| Campaign | Status | Spend | Conv | Clicks | Impr | CTR | CPC | CPA |\n|---|---|---|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const m = r.metrics;
              const cpa = Number(m.conversions) > 0 ? formatMicros(Number(m.cost_micros) / Number(m.conversions)) : "—";
              return `| ${r.campaign.name} | ${r.campaign.status} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions).toFixed(1)} | ${m.clicks} | ${m.impressions} | ${formatPercent(m.ctr)} | ${formatMicros(m.average_cpc)} | ${cpa} |`;
            })
            .join("\n");
          return `Campaign Performance (${date_range}) — ${rows.length} campaigns\n\n**Totals**: ${formatMicros(totalSpend)} spend, ${totalConv.toFixed(1)} conversions\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── search_terms_report ─────────────────────────────────────────────────────

server.tool(
  "search_terms_report",
  {
    description:
      "Search terms that triggered ads — wasted spend detection and top performers.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
      limit: limitSchema,
      sort_by: z.enum(["cost", "conversions", "clicks", "impressions"]).default("cost"),
    },
  },
  async ({ customer_id, date_range, limit, sort_by }) => {
    try {
      checkRateLimit("search_terms_report");
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const orderMap = {
        cost: "metrics.cost_micros",
        conversions: "metrics.conversions",
        clicks: "metrics.clicks",
        impressions: "metrics.impressions",
      };
      const results = await customer.query(`
        SELECT search_term_view.search_term, search_term_view.status,
               campaign.name, ad_group.name,
               metrics.impressions, metrics.clicks, metrics.conversions,
               metrics.cost_micros, metrics.ctr, metrics.cost_per_conversion
        FROM search_term_view
        WHERE segments.date DURING ${date_range}
        ORDER BY ${orderMap[sort_by]} DESC
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
          const wastedRows = rows.filter((r) => Number(r.metrics.conversions) === 0 && Number(r.metrics.cost_micros) > 0);
          const wastedSpend = wastedRows.reduce((s, r) => s + Number(r.metrics.cost_micros), 0);
          const header = "| Search Term | Campaign | Clicks | Conv | Spend | CTR | CPA |\n|---|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const m = r.metrics;
              const cpa = Number(m.conversions) > 0 ? formatMicros(Number(m.cost_micros) / Number(m.conversions)) : "—";
              return `| ${r.search_term_view.search_term} | ${r.campaign.name} | ${m.clicks} | ${Number(m.conversions).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${formatPercent(m.ctr)} | ${cpa} |`;
            })
            .join("\n");
          let summary = `Search Terms (${date_range}) — ${rows.length} terms\n\n`;
          if (wastedRows.length > 0) {
            summary += `**Wasted spend**: ${formatMicros(wastedSpend)} across ${wastedRows.length} terms with zero conversions\n\n`;
          }
          return `${summary}${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── keyword_quality ─────────────────────────────────────────────────────────

server.tool(
  "keyword_quality",
  {
    description: "Keyword quality scores with component breakdowns (creative, landing page, expected CTR).",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: z.enum(["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"]).default("LAST_30_DAYS"),
      min_impressions: z.number().default(10),
      limit: limitSchema,
    },
  },
  async ({ customer_id, date_range, min_impressions, limit }) => {
    try {
      checkRateLimit("keyword_quality");
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
        WHERE segments.date DURING ${date_range}
          AND ad_group_criterion.status = 'ENABLED'
          AND metrics.impressions > ${min_impressions}
        ORDER BY ad_group_criterion.quality_info.quality_score ASC
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
          const lowQS = rows.filter((r) => Number(r.ad_group_criterion?.quality_info?.quality_score || 10) < 5);
          const header = "| Keyword | Match | QS | Creative | Landing | CTR Pred | Campaign | Impr | Spend |\n|---|---|---|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const kw = r.ad_group_criterion;
              const qi = kw.quality_info || {};
              const qs = qi.quality_score ?? "—";
              return `| ${kw.keyword.text} | ${kw.keyword.match_type} | ${qs}/10 | ${qi.creative_quality_score || "—"} | ${qi.post_click_quality_score || "—"} | ${qi.search_predicted_ctr || "—"} | ${r.campaign.name} | ${r.metrics.impressions} | ${formatMicros(r.metrics.cost_micros)} |`;
            })
            .join("\n");
          let summary = `Keyword Quality (${date_range}) — ${rows.length} keywords\n\n`;
          if (lowQS.length > 0) summary += `**${lowQS.length} keywords with QS < 5** need attention\n\n`;
          return `${summary}${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── ad_performance ──────────────────────────────────────────────────────────

server.tool(
  "ad_performance",
  {
    description: "Ad creative performance — RSA ad strength, clicks, conversions, fatigue signals.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
      limit: limitSchema.default(30),
    },
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("ad_performance");
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
        WHERE segments.date DURING ${date_range}
          AND ad_group_ad.status = 'ENABLED'
        ORDER BY metrics.impressions DESC
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
          const header = "| Ad ID | Type | Strength | Campaign | Ad Group | Impr | Clicks | Conv | Spend | CTR |\n|---|---|---|---|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const ad = r.ad_group_ad;
              const m = r.metrics;
              return `| ${ad.ad.id} | ${ad.ad.type} | ${ad.ad_strength} | ${r.campaign.name} | ${r.ad_group.name} | ${m.impressions} | ${m.clicks} | ${Number(m.conversions).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${formatPercent(m.ctr)} |`;
            })
            .join("\n");
          return `Ad Performance (${date_range}) — ${rows.length} ads\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── budget_analysis ─────────────────────────────────────────────────────────

server.tool(
  "budget_analysis",
  {
    description: "Budget allocation and efficiency — identifies budget-limited campaigns and misallocated spend.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
    },
  },
  async ({ customer_id, date_range }) => {
    try {
      checkRateLimit("budget_analysis");
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
        WHERE segments.date DURING ${date_range} AND campaign.status = 'ENABLED'
        ORDER BY metrics.cost_micros DESC
      `);
      return text(
        fmt(results, (rows) => {
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
              return `| ${r.campaign.name} | ${formatMicros(b.amount_micros)} | ${formatMicros(m.cost_micros)} | ${pct}% | ${Number(m.conversions).toFixed(1)} | ${roas}x | ${r.campaign.bidding_strategy_type} | ${limited} |`;
            })
            .join("\n");
          let summary = `Budget Analysis (${date_range}) — ${rows.length} campaigns\n\n**Total spend**: ${formatMicros(totalSpend)}\n`;
          if (budgetLimited.length > 0) summary += `**${budgetLimited.length} campaigns budget-limited**\n`;
          return `${summary}\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── geo_performance ─────────────────────────────────────────────────────────

server.tool(
  "geo_performance",
  {
    description: "Geographic performance breakdown by location.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
      limit: limitSchema.default(30),
    },
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("geo_performance");
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const results = await customer.query(`
        SELECT geographic_view.country_criterion_id,
               geographic_view.location_type, campaign.name,
               metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.cost_micros,
               metrics.ctr, metrics.cost_per_conversion
        FROM geographic_view
        WHERE segments.date DURING ${date_range}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
          const header = "| Location ID | Type | Campaign | Impr | Clicks | Conv | Spend | CTR | CPA |\n|---|---|---|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const m = r.metrics;
              const cpa = Number(m.conversions) > 0 ? formatMicros(Number(m.cost_micros) / Number(m.conversions)) : "—";
              return `| ${r.geographic_view.country_criterion_id} | ${r.geographic_view.location_type} | ${r.campaign.name} | ${m.impressions} | ${m.clicks} | ${Number(m.conversions).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${formatPercent(m.ctr)} | ${cpa} |`;
            })
            .join("\n");
          return `Geographic Performance (${date_range})\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── device_performance (NEW — from Buddy) ──────────────────────────────────

server.tool(
  "device_performance",
  {
    description: "Performance breakdown by device (mobile, desktop, tablet) — identifies device-level optimization opportunities.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
    },
  },
  async ({ customer_id, date_range }) => {
    try {
      checkRateLimit("device_performance");
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const results = await customer.query(`
        SELECT segments.device, campaign.name,
               metrics.cost_micros, metrics.conversions,
               metrics.clicks, metrics.impressions,
               metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date DURING ${date_range}
          AND campaign.status = 'ENABLED'
        ORDER BY metrics.cost_micros DESC
      `);
      return text(
        fmt(results, (rows) => {
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
              const ctr = d.impr > 0 ? ((d.clicks / d.impr) * 100).toFixed(2) + "%" : "—";
              const cpa = d.conv > 0 ? formatMicros(d.spend / d.conv) : "—";
              return `| ${device} | ${formatMicros(d.spend)} | ${d.conv.toFixed(1)} | ${d.clicks} | ${d.impr} | ${ctr} | ${cpa} |`;
            })
            .join("\n");
          return `Device Performance (${date_range})\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── impression_share (NEW — from Buddy) ─────────────────────────────────────

server.tool(
  "impression_share",
  {
    description: "Impression share analysis — identifies lost opportunity from budget and rank. Shows how much traffic you're missing.",
    inputSchema: {
      customer_id: customerIdSchema,
      date_range: dateRangeSchema,
      limit: limitSchema.default(20),
    },
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      checkRateLimit("impression_share");
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
        WHERE segments.date DURING ${date_range}
          AND campaign.status = 'ENABLED'
          AND metrics.impressions > 0
        ORDER BY metrics.search_budget_lost_impression_share DESC
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
          const header = "| Campaign | Impr Share | Lost (Budget) | Lost (Rank) | Spend | Conv |\n|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const m = r.metrics;
              const is = m.search_impression_share ? (Number(m.search_impression_share) * 100).toFixed(1) + "%" : "—";
              const lb = m.search_budget_lost_impression_share ? (Number(m.search_budget_lost_impression_share) * 100).toFixed(1) + "%" : "—";
              const lr = m.search_rank_lost_impression_share ? (Number(m.search_rank_lost_impression_share) * 100).toFixed(1) + "%" : "—";
              return `| ${r.campaign.name} | ${is} | ${lb} | ${lr} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions).toFixed(1)} |`;
            })
            .join("\n");
          return `Impression Share (${date_range})\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── change_history (NEW — from Buddy) ───────────────────────────────────────

server.tool(
  "change_history",
  {
    description: "Recent account changes — who changed what and when. Essential for diagnosing performance shifts.",
    inputSchema: {
      customer_id: customerIdSchema,
      limit: limitSchema.default(25),
    },
  },
  async ({ customer_id, limit }) => {
    try {
      checkRateLimit("change_history");
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
      return text(
        fmt(results, (rows) => {
          const header = "| Date | Resource | Operation | User | Campaign | Changed Fields |\n|---|---|---|---|---|---|";
          const body = rows
            .map((r) => {
              const e = r.change_event;
              const fields = Array.isArray(e.changed_fields) ? e.changed_fields.join(", ") : String(e.changed_fields || "—");
              return `| ${e.change_date_time} | ${e.change_resource_type} | ${e.resource_change_operation} | ${e.user_email || "System"} | ${r.campaign?.name || "—"} | ${fields.slice(0, 80)} |`;
            })
            .join("\n");
          return `Change History (Last 14 Days) — ${rows.length} changes\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── list_recommendations (NEW — from Buddy) ────────────────────────────────

server.tool(
  "list_recommendations",
  {
    description: "Google's optimization recommendations for the account — with estimated impact.",
    inputSchema: {
      customer_id: customerIdSchema,
      limit: limitSchema.default(20),
    },
  },
  async ({ customer_id, limit }) => {
    try {
      checkRateLimit("list_recommendations");
      const client = getClient();
      const customer = getCustomerForId(client, customer_id);
      const results = await customer.query(`
        SELECT recommendation.type, recommendation.impact.base_metrics.impressions,
               recommendation.impact.base_metrics.clicks,
               recommendation.impact.base_metrics.cost_micros,
               recommendation.impact.potential_metrics.impressions,
               recommendation.impact.potential_metrics.clicks,
               recommendation.impact.potential_metrics.cost_micros,
               recommendation.campaign, recommendation.dismissed
        FROM recommendation
        WHERE recommendation.dismissed = FALSE
        LIMIT ${limit}
      `);
      return text(
        fmt(results, (rows) => {
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
              return `| ${rec.type} | +${imprLift} | +${clickLift} | ${formatMicros(costChange)} | ${rec.campaign || "—"} |`;
            })
            .join("\n");
          return `Recommendations — ${rows.length} active\n\n${header}\n${body}`;
        })
      );
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── compare_performance (NEW — from Buddy) ──────────────────────────────────

server.tool(
  "compare_performance",
  {
    description: "Compare campaign performance across two periods (e.g., this month vs last month). Shows deltas and identifies trends.",
    inputSchema: {
      customer_id: customerIdSchema,
      period_a: z.enum(["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "THIS_MONTH"]).describe("Current/recent period"),
      period_b: z.enum(["LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "LAST_MONTH"]).describe("Comparison period"),
      limit: limitSchema.default(15),
    },
  },
  async ({ customer_id, period_a, period_b, limit }) => {
    try {
      checkRateLimit("compare_performance");
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

      return text(`Period Comparison: ${period_a} vs ${period_b}\n\n${header}\n${body}`);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── calculate (NEW — from Buddy) ────────────────────────────────────────────

server.tool(
  "calculate",
  {
    description: "Google Ads math calculator — budget projections, ROAS, CPA, conversion forecasts, impression share opportunity. No API call needed.",
    inputSchema: {
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
  {
    description: "Execute a custom GAQL query (read-only). Only SELECT queries are allowed — all write operations are blocked.",
    inputSchema: {
      customer_id: customerIdSchema,
      query: z.string().describe("GAQL SELECT query"),
    },
  },
  async ({ customer_id, query }) => {
    try {
      checkRateLimit("run_gaql");
      const trimmed = query.trim();
      if (!trimmed.toUpperCase().startsWith("SELECT")) {
        return text("Only SELECT queries are allowed. Write operations are blocked for safety.");
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
  {
    description: "Quick health check — anomaly detection for zero conversions, budget limits, quality scores, spend drops.",
    inputSchema: {
      customer_id: customerIdSchema,
    },
  },
  async ({ customer_id }) => {
    try {
      checkRateLimit("account_health");
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
      return text(report);
    } catch (e) {
      return text(safeError(e));
    }
  }
);

// ─── Connect ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
