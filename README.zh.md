# Google Ads Agent — Gemini CLI 扩展

**语言：** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

一款 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 扩展，让你在终端中**实时访问 Google Ads API**。用自然语言询问广告系列、发现浪费的支出、审计账号并获取优化建议。

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


基于在 [googleadsagent.ai](https://googleadsagent.ai) 运行 AI Google Ads 代理的生产经验构建 — 28 个自定义 API 操作、6 个子代理，通过 Google Ads API v23 管理真实 Google Ads 账号。


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## 快速上手（约 5 分钟）

### 第 1 步：安装 Node.js（若尚未安装）

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### 第 2 步：安装 Gemini CLI

```bash
npm install -g @google/gemini-cli
```

### 第 3 步：获取 Gemini API 密钥（免费）

1. 打开 [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. 点击 **Create API Key**
3. 复制密钥并保存：

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

免费层级为每分钟 60 次请求、每天 1,000 次，通常足够使用。

### 第 4 步：安装本扩展

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

按提示确认安装并输入 Google Ads 凭据（见下文[获取凭据](#获取凭据)）。敏感信息保存在系统钥匙串中。

### 第 5 步：开始使用

```bash
gemini
```

完成。扩展每次都会自动加载。直接提问即可：

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## 使用示例

安装后输入 `gemini` 启动交互式 CLI。你可以：

### 查询账号（实时 API）

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### 发现问题

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### 做出更改（实时 API — 需确认）

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### 做计算（无需 API 凭据）

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### 斜杠命令

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### 切换主题

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## 包含内容

本扩展覆盖 Gemini CLI 扩展规范中的各类功能：

| 功能 | 内容 |
|---------|----------------|
| **MCP 服务器** | 22 个工具 — 15 个只读 + 7 个写入，直连 Google Ads API |
| **命令** | `/google-ads:analyze`、`/google-ads:audit`、`/google-ads:optimize` |
| **Skills** | `google-ads-agent`（PPC 专业 + GAQL 模板）与 `security-auditor`（漏洞扫描） |
| **上下文** | `GEMINI.md` — 每次会话加载的持久 API 参考 |
| **Hooks** | GAQL 写入拦截 + 每次工具调用的审计日志 |
| **策略** | 执行任何 API 调用前需用户确认 |
| **主题** | `google-ads`（深色）与 `google-ads-light`（浅色） |
| **设置** | 5 个凭据字段，敏感值存入系统钥匙串 |

---

## MCP 服务器 — 22 个工具

### 只读工具（15）

用于查询 Google Ads 账号：

| 工具 | 说明 |
|------|-------------|
| `list_accounts` | 列出 MCC 下所有账号 |
| `campaign_performance` | 花费、转化、点击、展示、CTR、CPC、CPA |
| `search_terms_report` | 搜索词分析与浪费支出检测 |
| `keyword_quality` | 质量得分及组成（创意、着陆页、预期 CTR） |
| `ad_performance` | 广告创意表现与 RSA 强度分 |
| `budget_analysis` | 预算分配、效率与受限广告系列检测 |
| `geo_performance` | 按地理位置拆分表现 |
| `device_performance` | 按设备拆分 — 手机、桌面、平板 |
| `impression_share` | 展示次数份额及因预算或排名损失的机会 |
| `change_history` | 近期账号变更 — 谁改了什么、何时 |
| `list_recommendations` | Google 优化建议及预估影响 |
| `compare_performance` | 跨期对比与差值（如本月与上月） |
| `calculate` | Google Ads 计算 — 预算预测、ROAS、CPA、转化预测 |
| `run_gaql` | 自定义 GAQL 查询（只读 — 所有写入操作被拦截） |
| `account_health` | 快速健康检查与自动异常检测 |

### 写入工具（7）

会修改 Google Ads 账号。**每个写入工具在执行前都必须经你明确确认。**

| 工具 | 说明 |
|------|-------------|
| `pause_campaign` | 暂停投放中的广告系列（先显示当前状态） |
| `enable_campaign` | 重新启用已暂停的广告系列 |
| `update_bid` | 修改广告组的 CPC 出价（显示前后对比） |
| `update_budget` | 修改广告系列日预算（前后对比 + 月度估算） |
| `add_negative_keywords` | 添加否定关键字以屏蔽不想要的搜索词（每次最多 50 个） |
| `create_responsive_search_ad` | 新建 RSA（标题与描述；创建为 PAUSED 供审核） |
| `apply_recommendation` | 应用 Google 的某条优化建议 |

### 安全

- **默认只读**：`run_gaql` 仅允许 SELECT — CREATE、UPDATE、DELETE、MUTATE、REMOVE 均被拦截
- **策略引擎**：每个 API 工具运行前需你确认
- **速率限制**：每个工具每分钟 10 次调用，防止失控使用
- **错误脱敏**：不暴露内部 API 细节 — 返回清晰、可操作的错误信息
- **审计日志**：每次工具调用写入 `~/.gemini/logs/google-ads-agent.log`

---

## 获取凭据

你需要来自 **3 处**的 **5 个值**。一次性配置即可。

### 来自 Google Ads（2 个值）

1. 打开 [ads.google.com](https://ads.google.com)
2. 点击 **Tools & Settings**（扳手）→ **API Center**
3. 复制 **Developer Token**
4. 记下 **Login Customer ID** — 即 MCC（经理）账号 ID，页面顶部的 10 位数字（格式：`123-456-7890`）

> **还没有 API 访问权限？** 需要[申请 developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token)。基础访问通常在数天内获批。

### 来自 Google Cloud Console（2 个值）

1. 打开 [console.cloud.google.com](https://console.cloud.google.com)
2. 创建项目（或选择已有项目）
3. 进入 **APIs & Services** → **Library** → 搜索 “Google Ads API” → **Enable**
4. 进入 **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. 应用类型选择 **Web application**
6. 将 `https://developers.google.com/oauthplayground` 添加为已授权重定向 URI
7. 复制 **Client ID** 与 **Client Secret**

### 来自 OAuth Playground（1 个值）

1. 打开 [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)
2. 点击右上角**齿轮** → 勾选 **Use your own OAuth credentials**
3. 粘贴上一步的 **Client ID** 与 **Client Secret**
4. 在左栏找到 **Google Ads API v23** → 选择 `https://www.googleapis.com/auth/adwords`
5. 点击 **Authorize APIs** → 使用有权访问 Google Ads 的 Google 账号登录
6. 点击 **Exchange authorization code for tokens**
7. 复制 **Refresh Token**

### 输入凭据

```bash
gemini extensions config google-ads-agent
```

将逐项提示。敏感字段（developer token、client secret、refresh token）保存在系统钥匙串 — 非明文。

---

## 命令

三条斜杠命令用于结构化分析：

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
当你询问广告系列、预算、关键字、广告、PPC、ROAS、出价或 Performance Max 时会自动激活。包含：
- 常用报表的 GAQL 查询模板
- 费用格式（Google 使用 micros — skill 会换算为美元）
- 异常阈值（CPA 飙升 >20%、零转化、预算上限）
- 写入安全流程：确认 → 执行 → 事后检查

### Security Auditor
当你要求安全审计、扫描密钥或检查漏洞时激活。包含：
- 10+ 种密钥模式（sk-、AIzaSy、ghp_、AKIA、xox、whsec_ 等）
- 认证/授权、输入校验、错误处理、加密等检查
- 严重级别框架（Critical / High / Medium / Low）

---

## 扩展结构

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

## 更新

```bash
gemini extensions update google-ads-agent
```

## 卸载

```bash
gemini extensions uninstall google-ads-agent
```

## 本地开发

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

更改会自动重载 — 无需重新安装。

## 故障排除

| 问题 | 处理 |
|---------|----------|
| `command not found: gemini` | 运行 `npm install -g @google/gemini-cli` |
| `Please set an Auth method` | 创建 `~/.gemini/.env`，写入 `GEMINI_API_KEY=your-key`（[免费获取](https://aistudio.google.com/apikey)） |
| `Missing Google Ads credentials` | 运行 `gemini extensions config google-ads-agent` |
| `Authentication failed` | refresh token 可能已过期 — 在 [OAuth Playground](https://developers.google.com/oauthplayground/) 重新生成 |
| `Permission denied` | 确认该账号在你的 MCC 下可访问 |
| `Rate limit exceeded` | 等待 60 秒 — 扩展限制为每工具每分钟 10 次调用 |

## 相关项目

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — 面向 Claude 的 Anthropic Agent Skills（分析、审计、写入、数学、MCP）
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — 含 29 个工具的 Python MCP 服务器
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — 完整 Python 代理，28 个 API 操作与 6 个子代理
- [googleadsagent.ai](https://googleadsagent.ai) — Cloudflare 上的生产系统（Buddy）
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## 许可证

MIT
