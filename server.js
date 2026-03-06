import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleAdsApi } from "google-ads-api";

const server = new McpServer({
  name: "google-ads-agent",
  version: "2.0.0",
});

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

function getCustomer(client) {
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  return client.Customer({
    customer_id: loginCustomerId,
    login_customer_id: loginCustomerId,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  });
}

function formatMicros(micros) {
  return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function resultToText(rows, formatFn) {
  if (!rows || rows.length === 0) return "No data found.";
  return formatFn(rows);
}

// ─── Tool: List accessible accounts ──────────────────────────────────────────

server.tool(
  "list_accounts",
  {
    description: "List all Google Ads accounts accessible under the configured MCC. Returns account IDs, names, and status.",
  },
  async () => {
    try {
      const client = getClient();
      const customer = getCustomer(client);
      const results = await customer.query(`
        SELECT customer_client.id, customer_client.descriptive_name,
               customer_client.status, customer_client.manager,
               customer_client.currency_code
        FROM customer_client
        WHERE customer_client.status = 'ENABLED'
        ORDER BY customer_client.descriptive_name
      `);
      const text = resultToText(results, (rows) => {
        const header = "| Account ID | Name | Manager | Currency |\n|---|---|---|---|";
        const body = rows.map((r) => {
          const c = r.customer_client;
          return `| ${c.id} | ${c.descriptive_name} | ${c.manager ? "Yes" : "No"} | ${c.currency_code} |`;
        }).join("\n");
        return `Found ${rows.length} accounts:\n\n${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Campaign performance ──────────────────────────────────────────────

server.tool(
  "campaign_performance",
  {
    description: "Get campaign performance metrics for a Google Ads account. Returns spend, conversions, clicks, impressions, CTR, CPC, and CPA.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID (e.g., 1234567890, no dashes)"),
      date_range: z.enum([
        "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS",
        "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "LAST_MONTH"
      ]).default("LAST_30_DAYS").describe("Date range for the report"),
      status: z.enum(["ENABLED", "PAUSED", "ALL"]).default("ENABLED").describe("Campaign status filter"),
      limit: z.number().min(1).max(100).default(20).describe("Max campaigns to return"),
    },
  },
  async ({ customer_id, date_range, status, limit }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

      const statusClause = status === "ALL" ? "" : `AND campaign.status = '${status}'`;
      const results = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status,
               campaign.bidding_strategy_type,
               metrics.cost_micros, metrics.conversions,
               metrics.conversions_value, metrics.clicks,
               metrics.impressions, metrics.ctr, metrics.average_cpc,
               metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date DURING ${date_range}
          ${statusClause}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);

      const text = resultToText(results, (rows) => {
        const totalSpend = rows.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
        const totalConv = rows.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
        const totalClicks = rows.reduce((s, r) => s + Number(r.metrics.clicks || 0), 0);

        const header = "| Campaign | Status | Spend | Conversions | Clicks | Impr | CTR | CPC | CPA |\n|---|---|---|---|---|---|---|---|---|";
        const body = rows.map((r) => {
          const m = r.metrics;
          const cpa = Number(m.conversions) > 0
            ? formatMicros(Number(m.cost_micros) / Number(m.conversions))
            : "N/A";
          return `| ${r.campaign.name} | ${r.campaign.status} | ${formatMicros(m.cost_micros)} | ${Number(m.conversions).toFixed(1)} | ${m.clicks} | ${m.impressions} | ${formatPercent(m.ctr)} | ${formatMicros(m.average_cpc)} | ${cpa} |`;
        }).join("\n");

        return `Campaign Performance (${date_range}) — ${rows.length} campaigns\n\n**Totals**: ${formatMicros(totalSpend)} spend, ${totalConv.toFixed(1)} conversions, ${totalClicks} clicks\n\n${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Search terms report ───────────────────────────────────────────────

server.tool(
  "search_terms_report",
  {
    description: "Get search terms that triggered ads. Identifies wasted spend (high cost, zero conversions) and top performers.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
      date_range: z.enum([
        "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS",
        "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "LAST_MONTH"
      ]).default("LAST_30_DAYS"),
      limit: z.number().min(1).max(200).default(50),
      sort_by: z.enum(["cost", "conversions", "clicks", "impressions"]).default("cost").describe("Sort results by this metric"),
    },
  },
  async ({ customer_id, date_range, limit, sort_by }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

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

      const text = resultToText(results, (rows) => {
        const wastedRows = rows.filter(
          (r) => Number(r.metrics.conversions) === 0 && Number(r.metrics.cost_micros) > 0
        );
        const wastedSpend = wastedRows.reduce(
          (s, r) => s + Number(r.metrics.cost_micros), 0
        );

        const header = "| Search Term | Campaign | Clicks | Conv | Spend | CTR | CPA | Status |\n|---|---|---|---|---|---|---|---|";
        const body = rows.map((r) => {
          const m = r.metrics;
          const cpa = Number(m.conversions) > 0
            ? formatMicros(Number(m.cost_micros) / Number(m.conversions))
            : "—";
          const flag = Number(m.conversions) === 0 && Number(m.cost_micros) > 1_000_000 ? " ⚠️" : "";
          return `| ${r.search_term_view.search_term}${flag} | ${r.campaign.name} | ${m.clicks} | ${Number(m.conversions).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${formatPercent(m.ctr)} | ${cpa} | ${r.search_term_view.status} |`;
        }).join("\n");

        let summary = `Search Terms (${date_range}) — ${rows.length} terms\n\n`;
        if (wastedRows.length > 0) {
          summary += `**Wasted spend**: ${formatMicros(wastedSpend)} across ${wastedRows.length} terms with zero conversions\n\n`;
        }
        return `${summary}${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Keyword quality scores ────────────────────────────────────────────

server.tool(
  "keyword_quality",
  {
    description: "Get keyword quality scores — identifies low-quality keywords dragging down account performance.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
      date_range: z.enum([
        "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"
      ]).default("LAST_30_DAYS"),
      min_impressions: z.number().default(10).describe("Minimum impressions to include"),
      limit: z.number().min(1).max(200).default(50),
    },
  },
  async ({ customer_id, date_range, min_impressions, limit }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

      const results = await customer.query(`
        SELECT ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type,
               ad_group_criterion.quality_info.quality_score,
               ad_group_criterion.quality_info.creative_quality_score,
               ad_group_criterion.quality_info.post_click_quality_score,
               ad_group_criterion.quality_info.search_predicted_ctr,
               campaign.name, ad_group.name,
               metrics.impressions, metrics.clicks, metrics.cost_micros,
               metrics.conversions
        FROM keyword_view
        WHERE segments.date DURING ${date_range}
          AND ad_group_criterion.status = 'ENABLED'
          AND metrics.impressions > ${min_impressions}
        ORDER BY ad_group_criterion.quality_info.quality_score ASC
        LIMIT ${limit}
      `);

      const text = resultToText(results, (rows) => {
        const lowQuality = rows.filter(
          (r) => Number(r.ad_group_criterion?.quality_info?.quality_score || 10) < 5
        );

        const header = "| Keyword | Match | QS | Creative | Landing | CTR Pred | Campaign | Impr | Spend |\n|---|---|---|---|---|---|---|---|---|";
        const body = rows.map((r) => {
          const kw = r.ad_group_criterion;
          const qi = kw.quality_info || {};
          const qs = qi.quality_score ?? "—";
          const flag = Number(qs) < 5 && qs !== "—" ? " ⚠️" : "";
          return `| ${kw.keyword.text}${flag} | ${kw.keyword.match_type} | ${qs}/10 | ${qi.creative_quality_score || "—"} | ${qi.post_click_quality_score || "—"} | ${qi.search_predicted_ctr || "—"} | ${r.campaign.name} | ${r.metrics.impressions} | ${formatMicros(r.metrics.cost_micros)} |`;
        }).join("\n");

        let summary = `Keyword Quality (${date_range}) — ${rows.length} keywords\n\n`;
        if (lowQuality.length > 0) {
          summary += `**${lowQuality.length} keywords with QS < 5** — these need attention\n\n`;
        }
        return `${summary}${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Ad performance ────────────────────────────────────────────────────

server.tool(
  "ad_performance",
  {
    description: "Get ad creative performance — RSA ad strength, clicks, conversions. Identifies fatigue and underperformers.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
      date_range: z.enum([
        "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"
      ]).default("LAST_30_DAYS"),
      limit: z.number().min(1).max(100).default(30),
    },
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

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

      const text = resultToText(results, (rows) => {
        const header = "| Ad ID | Type | Strength | Campaign | Ad Group | Impr | Clicks | Conv | Spend | CTR |\n|---|---|---|---|---|---|---|---|---|---|";
        const body = rows.map((r) => {
          const ad = r.ad_group_ad;
          const m = r.metrics;
          const strengthFlag = ad.ad_strength === "POOR" || ad.ad_strength === "AVERAGE" ? " ⚠️" : "";
          return `| ${ad.ad.id} | ${ad.ad.type} | ${ad.ad_strength}${strengthFlag} | ${r.campaign.name} | ${r.ad_group.name} | ${m.impressions} | ${m.clicks} | ${Number(m.conversions).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${formatPercent(m.ctr)} |`;
        }).join("\n");

        return `Ad Performance (${date_range}) — ${rows.length} ads\n\n${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Budget analysis ───────────────────────────────────────────────────

server.tool(
  "budget_analysis",
  {
    description: "Analyze budget allocation and efficiency. Identifies budget-limited campaigns and misallocated spend.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
      date_range: z.enum([
        "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"
      ]).default("LAST_30_DAYS"),
    },
  },
  async ({ customer_id, date_range }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

      const results = await customer.query(`
        SELECT campaign.name, campaign.status,
               campaign_budget.amount_micros,
               campaign_budget.has_recommended_budget,
               campaign_budget.recommended_budget_amount_micros,
               campaign.bidding_strategy_type,
               metrics.cost_micros, metrics.conversions,
               metrics.conversions_value, metrics.clicks,
               metrics.impressions
        FROM campaign
        WHERE segments.date DURING ${date_range}
          AND campaign.status = 'ENABLED'
        ORDER BY metrics.cost_micros DESC
      `);

      const text = resultToText(results, (rows) => {
        const totalSpend = rows.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
        const totalConv = rows.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
        const budgetLimited = rows.filter((r) => r.campaign_budget.has_recommended_budget);

        const header = "| Campaign | Daily Budget | Spend | % of Total | Conv | ROAS | Bid Strategy | Budget Limited |\n|---|---|---|---|---|---|---|---|";
        const body = rows.map((r) => {
          const m = r.metrics;
          const b = r.campaign_budget;
          const pct = totalSpend > 0 ? ((Number(m.cost_micros) / totalSpend) * 100).toFixed(1) : "0";
          const roas = Number(m.cost_micros) > 0
            ? (Number(m.conversions_value) / (Number(m.cost_micros) / 1_000_000)).toFixed(2)
            : "—";
          const limited = b.has_recommended_budget ? `Yes → ${formatMicros(b.recommended_budget_amount_micros)}` : "No";
          return `| ${r.campaign.name} | ${formatMicros(b.amount_micros)} | ${formatMicros(m.cost_micros)} | ${pct}% | ${Number(m.conversions).toFixed(1)} | ${roas}x | ${r.campaign.bidding_strategy_type} | ${limited} |`;
        }).join("\n");

        let summary = `Budget Analysis (${date_range}) — ${rows.length} campaigns\n\n`;
        summary += `**Total spend**: ${formatMicros(totalSpend)} | **Total conversions**: ${totalConv.toFixed(1)}\n`;
        if (budgetLimited.length > 0) {
          summary += `**${budgetLimited.length} campaigns are budget-limited** — consider increasing budgets on these\n`;
        }
        return `${summary}\n${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Geographic performance ────────────────────────────────────────────

server.tool(
  "geo_performance",
  {
    description: "Get geographic performance breakdown — identify top and bottom performing locations.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
      date_range: z.enum([
        "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"
      ]).default("LAST_30_DAYS"),
      limit: z.number().min(1).max(100).default(30),
    },
  },
  async ({ customer_id, date_range, limit }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

      const results = await customer.query(`
        SELECT geographic_view.country_criterion_id,
               geographic_view.location_type,
               campaign.name,
               metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.cost_micros,
               metrics.ctr, metrics.cost_per_conversion
        FROM geographic_view
        WHERE segments.date DURING ${date_range}
        ORDER BY metrics.cost_micros DESC
        LIMIT ${limit}
      `);

      const text = resultToText(results, (rows) => {
        const header = "| Location ID | Type | Campaign | Impr | Clicks | Conv | Spend | CTR | CPA |\n|---|---|---|---|---|---|---|---|---|";
        const body = rows.map((r) => {
          const m = r.metrics;
          const cpa = Number(m.conversions) > 0 ? formatMicros(Number(m.cost_micros) / Number(m.conversions)) : "—";
          return `| ${r.geographic_view.country_criterion_id} | ${r.geographic_view.location_type} | ${r.campaign.name} | ${m.impressions} | ${m.clicks} | ${Number(m.conversions).toFixed(1)} | ${formatMicros(m.cost_micros)} | ${formatPercent(m.ctr)} | ${cpa} |`;
        }).join("\n");

        return `Geographic Performance (${date_range}) — ${rows.length} locations\n\n${header}\n${body}`;
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Run custom GAQL query ─────────────────────────────────────────────

server.tool(
  "run_gaql",
  {
    description: "Execute a custom GAQL (Google Ads Query Language) query. For advanced users who know the exact data they need.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
      query: z.string().describe("GAQL query string (e.g., SELECT campaign.name, metrics.clicks FROM campaign WHERE ...)"),
    },
  },
  async ({ customer_id, query }) => {
    try {
      const forbidden = ["CREATE", "UPDATE", "DELETE", "REMOVE", "MUTATE"];
      const upper = query.toUpperCase().trim();
      for (const word of forbidden) {
        if (upper.startsWith(word)) {
          return {
            content: [{
              type: "text",
              text: "Write operations are blocked for safety. This tool only supports SELECT queries. Use the Google Ads UI or dedicated mutation tools for changes.",
            }],
          };
        }
      }

      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

      const results = await customer.query(query);
      const text = results.length === 0
        ? "Query returned no results."
        : `Query returned ${results.length} rows:\n\n\`\`\`json\n${JSON.stringify(results.slice(0, 50), null, 2)}\n\`\`\`${results.length > 50 ? `\n\n(Showing first 50 of ${results.length} results)` : ""}`;

      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Query error: ${e.message}` }] };
    }
  }
);

// ─── Tool: Account health check ──────────────────────────────────────────────

server.tool(
  "account_health",
  {
    description: "Quick health check on a Google Ads account — checks for anomalies, budget issues, quality score problems, and conversion tracking.",
    inputSchema: {
      customer_id: z.string().describe("Google Ads customer ID"),
    },
  },
  async ({ customer_id }) => {
    try {
      const client = getClient();
      const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
      const customer = client.Customer({
        customer_id: customer_id.replace(/-/g, ""),
        login_customer_id: loginId,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      });

      const [campaigns, keywords] = await Promise.all([
        customer.query(`
          SELECT campaign.name, campaign.status,
                 campaign_budget.has_recommended_budget,
                 metrics.cost_micros, metrics.conversions, metrics.clicks,
                 metrics.impressions
          FROM campaign
          WHERE segments.date DURING LAST_7_DAYS
            AND campaign.status = 'ENABLED'
          ORDER BY metrics.cost_micros DESC
          LIMIT 50
        `),
        customer.query(`
          SELECT ad_group_criterion.quality_info.quality_score,
                 metrics.impressions
          FROM keyword_view
          WHERE segments.date DURING LAST_7_DAYS
            AND ad_group_criterion.status = 'ENABLED'
            AND metrics.impressions > 10
          LIMIT 200
        `),
      ]);

      const findings = [];

      const zeroConv = campaigns.filter(
        (r) => Number(r.metrics.cost_micros) > 10_000_000 && Number(r.metrics.conversions) === 0
      );
      if (zeroConv.length > 0) {
        findings.push(`**CRITICAL**: ${zeroConv.length} campaigns spending >$10 with ZERO conversions in last 7 days`);
      }

      const budgetLimited = campaigns.filter((r) => r.campaign_budget.has_recommended_budget);
      if (budgetLimited.length > 0) {
        findings.push(`**HIGH**: ${budgetLimited.length} campaigns are budget-limited`);
      }

      const lowQS = keywords.filter(
        (r) => Number(r.ad_group_criterion?.quality_info?.quality_score || 10) < 5
      );
      if (lowQS.length > 0) {
        const pct = ((lowQS.length / keywords.length) * 100).toFixed(0);
        findings.push(`**MEDIUM**: ${lowQS.length} keywords (${pct}%) have quality score < 5`);
      }

      const totalSpend = campaigns.reduce((s, r) => s + Number(r.metrics.cost_micros || 0), 0);
      const totalConv = campaigns.reduce((s, r) => s + Number(r.metrics.conversions || 0), 0);
      const totalClicks = campaigns.reduce((s, r) => s + Number(r.metrics.clicks || 0), 0);

      let report = `## Account Health Check (Last 7 Days)\n\n`;
      report += `**${campaigns.length}** active campaigns | **${formatMicros(totalSpend)}** spend | **${totalConv.toFixed(0)}** conversions | **${totalClicks}** clicks\n\n`;

      if (findings.length === 0) {
        report += "✅ No major issues detected. Account looks healthy.";
      } else {
        report += `### ${findings.length} Issues Found\n\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
      }

      return { content: [{ type: "text", text: report }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
