# Google Ads Agent — Gemini CLI 확장

**언어:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

터미널에서 **Google Ads API에 실시간으로 연결**해 주는 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 확장입니다. 캠페인을 물어보고, 낭비 지출을 찾고, 계정을 감사하고, 최적화 제안을 받을 수 있습니다 — 모두 자연스러운 대화로 진행됩니다.

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


[googleadsagent.ai](https://googleadsagent.ai)에서 AI Google Ads 에이전트를 운영하며 쌓은 프로덕션 경험을 바탕으로 만들었습니다 — 맞춤 API 액션 28개, 서브 에이전트 6개, Google Ads API v22로 실제 Google Ads 계정을 관리합니다.


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## 빠른 시작(5분)

### 1단계: Node.js 설치(없는 경우)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### 2단계: Gemini CLI 설치

```bash
npm install -g @google/gemini-cli
```

### 3단계: Gemini API 키 받기(무료)

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey)로 이동합니다.
2. **Create API Key**를 클릭합니다.
3. 키를 복사한 뒤 저장합니다:

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

무료 한도는 분당 60회, 하루 1,000회로 일반적으로 충분합니다.

### 4단계: 이 확장 설치

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

설치 확인과 Google Ads 자격 증명 입력을 요청합니다(아래 [자격 증명 받기](#자격-증명-받기) 참고). 민감한 값은 시스템 키체인에 저장됩니다.

### 5단계: 사용 시작

```bash
gemini
```

끝입니다. 확장은 매번 자동으로 로드됩니다. 질문만 하면 됩니다:

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## 사용 예시

설치 후 `gemini`를 입력해 대화형 CLI를 실행합니다. 할 수 있는 일:

### 계정 질문(실시간 API)

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### 문제 찾기

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### 변경하기(실시간 API — 확인 필요)

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### 계산하기(API 자격 증명 없음)

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### 슬래시 명령

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### 테마 전환

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## 포함 내용

Gemini CLI 확장 사양의 모든 기능 유형을 구현합니다:

| 기능 | 포함 내용 |
|---------|----------------|
| **MCP 서버** | 도구 22개 — 읽기 15 + 쓰기 7, Google Ads API 실시간 접근 |
| **명령** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent`(PPC 전문 + GAQL 템플릿), `security-auditor`(취약점 스캔) |
| **컨텍스트** | `GEMINI.md` — 세션마다 로드되는 지속 API 참고 |
| **Hooks** | GAQL 쓰기 차단 + 모든 도구 호출 감사 로깅 |
| **정책** | API 호출 실행 전 사용자 확인 필수 |
| **테마** | `google-ads`(다크), `google-ads-light`(라이트) |
| **설정** | 자격 필드 5개, 민감 값은 시스템 키체인 저장 |

---

## MCP 서버 — 도구 22개

### 읽기 도구(15)

Google Ads 계정을 조회합니다:

| 도구 | 설명 |
|------|-------------|
| `list_accounts` | MCC 아래 모든 계정 나열 |
| `campaign_performance` | 지출, 전환, 클릭, 노출, CTR, CPC, CPA |
| `search_terms_report` | 검색어 분석 및 낭비 지출 탐지 |
| `keyword_quality` | 품질 점수 및 구성 요소(소재, 랜딩페이지, 예상 CTR) |
| `ad_performance` | 광고 소재 성과 및 RSA 강도 점수 |
| `budget_analysis` | 예산 배분, 효율, 예산 제한 캠페인 탐지 |
| `geo_performance` | 지역별 성과 |
| `device_performance` | 기기별 성과 — 모바일, 데스크톱, 태블릿 |
| `impression_share` | 노출 점유율 및 예산·순위로 놓친 기회 |
| `change_history` | 최근 계정 변경 — 누가 무엇을 언제 |
| `list_recommendations` | Google 최적화 권장 및 예상 영향 |
| `compare_performance` | 기간 대비 비교 및 델타(예: 이번 달 vs 지난달) |
| `calculate` | Google Ads 계산 — 예산 추정, ROAS, CPA, 전환 예측 |
| `run_gaql` | 사용자 정의 GAQL(읽기 전용 — 쓰기 모두 차단) |
| `account_health` | 빠른 헬스 체크 및 이상 자동 탐지 |

### 쓰기 도구(7)

Google Ads 계정을 변경합니다. **모든 쓰기 도구는 실행 전 명시적 확인이 필요합니다.**

| 도구 | 설명 |
|------|-------------|
| `pause_campaign` | 진행 중 캠페인 일시중지(먼저 현재 상태 표시) |
| `enable_campaign` | 일시중지된 캠페인 다시 사용 |
| `update_bid` | 광고 그룹 CPC 입찰 변경(이전/이후) |
| `update_budget` | 캠페인 일일 예산 변경(이전/이후 + 월 추정) |
| `add_negative_keywords` | 원치 않는 검색어 차단용 제외 키워드 추가(한 번에 최대 50개) |
| `create_responsive_search_ad` | 제목·설명으로 새 RSA 생성(검토용 PAUSED로 생성) |
| `apply_recommendation` | Google 최적화 제안 중 하나 적용 |

### 안전

- **기본 읽기 전용**: `run_gaql`은 SELECT만 허용 — CREATE, UPDATE, DELETE, MUTATE, REMOVE 차단
- **정책 엔진**: 모든 API 도구는 실행 전 확인 필요
- **속도 제한**: 도구당 분당 10회 호출로 과도한 사용 방지
- **오류 정제**: 내부 API 세부는 노출하지 않음 — 명확하고 실행 가능한 메시지
- **감사 로깅**: 모든 도구 호출은 `~/.gemini/logs/google-ads-agent.log`에 기록

---

## 자격 증명 받기

**3곳**에서 **5개 값**이 필요합니다. 한 번만 설정하면 됩니다.

### Google Ads에서(2개)

1. [ads.google.com](https://ads.google.com)으로 이동합니다.
2. **Tools & Settings**(렌치 아이콘) → **API Center**
3. **Developer Token**을 복사합니다.
4. **Login Customer ID**를 적습니다 — MCC(매니저) 계정 ID, 상단 10자리 숫자(형식: `123-456-7890`)

> **API 접근이 없나요?** [developer token 신청](https://developers.google.com/google-ads/api/docs/get-started/dev-token)이 필요합니다. 기본 액세스는 보통 며칠 내 승인됩니다.

### Google Cloud Console에서(2개)

1. [console.cloud.google.com](https://console.cloud.google.com)으로 이동합니다.
2. 프로젝트를 만들거나 선택합니다.
3. **APIs & Services** → **Library** → "Google Ads API" 검색 → **Enable**
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. 애플리케이션 유형은 **Web application**
6. 승인된 리디렉션 URI에 `https://developers.google.com/oauthplayground` 추가
7. **Client ID**와 **Client Secret** 복사

### OAuth Playground에서(1개)

1. [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)로 이동합니다.
2. 오른쪽 위 **톱니바퀴** → **Use your own OAuth credentials** 선택
3. 이전 단계의 **Client ID**와 **Client Secret** 붙여넣기
4. 왼쪽 패널에서 **Google Ads API v22** 찾기 → `https://www.googleapis.com/auth/adwords` 선택
5. **Authorize APIs** → Google Ads에 접근 가능한 Google 계정으로 로그인
6. **Exchange authorization code for tokens** 클릭
7. **Refresh Token** 복사

### 자격 증명 입력

```bash
gemini extensions config google-ads-agent
```

각 값을 순서대로 묻습니다. 민감 필드(developer token, client secret, refresh token)는 시스템 키체인에 저장되며 평문으로 저장되지 않습니다.

---

## 명령

구조화된 분석용 슬래시 명령 세 가지:

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
캠페인, 예산, 키워드, 광고, PPC, ROAS, 입찰, Performance Max 등을 물으면 자동 활성화됩니다. 포함 내용:
- 일반 보고용 GAQL 쿼리 템플릿
- 비용 서식(Google은 micros 단위 — skill이 달러로 변환)
- 이상 탐지 임계값(CPA 급등 >20%, 전환 0, 예산 한도)
- 쓰기 안전 절차: 확인 → 실행 → 사후 점검

### Security Auditor
보안 감사, 비밀 스캔, 취약점 점검을 요청하면 활성화됩니다. 포함 내용:
- 비밀 패턴 10종 이상(sk-, AIzaSy, ghp_, AKIA, xox, whsec_ 등)
- 인증/인가, 입력 검증, 오류 처리, 암호화 점검
- 심각도 체계(Critical / High / Medium / Low)

---

## 확장 구조

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

## 업데이트

```bash
gemini extensions update google-ads-agent
```

## 제거

```bash
gemini extensions uninstall google-ads-agent
```

## 로컬 개발

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

변경 사항은 자동으로 다시 로드되므로 재설치할 필요가 없습니다.

## 문제 해결

| 문제 | 해결 |
|---------|----------|
| `command not found: gemini` | `npm install -g @google/gemini-cli` 실행 |
| `Please set an Auth method` | `~/.gemini/.env`에 `GEMINI_API_KEY=your-key` 생성([무료 키](https://aistudio.google.com/apikey)) |
| `Missing Google Ads credentials` | `gemini extensions config google-ads-agent` 실행 |
| `Authentication failed` | refresh token 만료 가능 — [OAuth Playground](https://developers.google.com/oauthplayground/)에서 재발급 |
| `Permission denied` | MCC에서 해당 계정에 접근 가능한지 확인 |
| `Rate limit exceeded` | 60초 대기 — 확장은 도구당 분당 10회로 제한 |

## 관련 항목

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — Claude용 Anthropic Agent Skills(분석, 감사, 쓰기, 수학, MCP)
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — 도구 29개 Python MCP 서버
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — API 액션 28개·서브 에이전트 6개 전체 Python 에이전트
- [googleadsagent.ai](https://googleadsagent.ai) — Cloudflare에서 운영되는 프로덕션 시스템(Buddy)
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## 라이선스

MIT
