# Google Ads Agent — расширение Gemini CLI

**Языки:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

Расширение для [Gemini CLI](https://github.com/google-gemini/gemini-cli), которое даёт **прямой доступ к Google Ads API** из терминала. Спрашивайте о кампаниях, ищите лишние расходы, проводите аудит аккаунтов и получайте рекомендации по оптимизации — всё в естественном диалоге.

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


Создано на основе продакшн-опыта AI-агента Google Ads на [googleadsagent.ai](https://googleadsagent.ai) — 28 пользовательских действий API, 6 субагентов, управление реальными аккаунтами Google Ads через Google Ads API v23.


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## Быстрый старт (5 минут)

### Шаг 1: Установите Node.js (если ещё нет)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### Шаг 2: Установите Gemini CLI

```bash
npm install -g @google/gemini-cli
```

### Шаг 3: Получите ключ Gemini API (бесплатно)

1. Перейдите на [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Нажмите **Create API Key**
3. Скопируйте ключ и сохраните:

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

Бесплатный уровень: 60 запросов в минуту и 1 000 в день — обычно более чем достаточно.

### Шаг 4: Установите это расширение

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

Подтвердите установку и введите учётные данные Google Ads (см. [Получение учётных данных](#получение-учётных-данных) ниже). Секретные значения хранятся в системной связке ключей.

### Шаг 5: Начните работу

```bash
gemini
```

Готово. Расширение подгружается автоматически. Просто задавайте вопросы:

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## Примеры использования

После установки введите `gemini` для интерактивного CLI. Вы можете:

### Спрашивать об аккаунтах (живой API)

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### Находить проблемы

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### Вносить изменения (живой API — нужно подтверждение)

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### Считать (без учётных данных API)

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### Команды со слэшем

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### Смена темы

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## Что входит

Расширение реализует все типы возможностей по спецификации расширений Gemini CLI:

| Возможность | Содержание |
|---------|----------------|
| **Сервер MCP** | 22 инструмента — 15 чтение + 7 запись с прямым доступом к Google Ads API |
| **Команды** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent` (экспертиза PPC + шаблоны GAQL) и `security-auditor` (поиск уязвимостей) |
| **Контекст** | `GEMINI.md` — постоянная справка по API в каждой сессии |
| **Hooks** | блокировка записи GAQL + аудит-лог каждого вызова инструмента |
| **Политики** | подтверждение пользователя перед любым вызовом API |
| **Темы** | `google-ads` (тёмная) и `google-ads-light` (светлая) |
| **Настройки** | 5 полей учётных данных; секреты — в системной связке ключей |

---

## Сервер MCP — 22 инструмента

### Инструменты чтения (15)

Запрашивают данные аккаунтов Google Ads:

| Инструмент | Описание |
|------|-------------|
| `list_accounts` | Список всех аккаунтов под вашим MCC |
| `campaign_performance` | Расходы, конверсии, клики, показы, CTR, CPC, CPA |
| `search_terms_report` | Анализ поисковых запросов и лишних расходов |
| `keyword_quality` | Показатели качества с разбивкой (креатив, посадочная, ожидаемый CTR) |
| `ad_performance` | Эффективность объявлений и оценки силы RSA |
| `budget_analysis` | Распределение бюджета, эффективность и кампании с ограничением бюджета |
| `geo_performance` | Показатели по географии |
| `device_performance` | По устройствам — мобильные, десктоп, планшеты |
| `impression_share` | Доля показов и упущенные возможности из‑за бюджета или ранга |
| `change_history` | Недавние изменения — кто, что и когда менял |
| `list_recommendations` | Рекомендации Google по оптимизации с оценкой эффекта |
| `compare_performance` | Сравнение периодов с дельтами (например, этот месяц vs прошлый) |
| `calculate` | Расчёты Google Ads — прогноз бюджета, ROAS, CPA, конверсии |
| `run_gaql` | Произвольные GAQL-запросы (только чтение — запись заблокирована) |
| `account_health` | Быстрая проверка состояния с автообнаружением аномалий |

### Инструменты записи (7)

Изменяют аккаунт Google Ads. **Перед выполнением каждого инструмента записи требуется ваше явное подтверждение.**

| Инструмент | Описание |
|------|-------------|
| `pause_campaign` | Приостановить активную кампанию (сначала показывается статус) |
| `enable_campaign` | Снова включить приостановленную кампанию |
| `update_bid` | Изменить ставку CPC для группы объявлений (до/после) |
| `update_budget` | Изменить дневной бюджет кампании (до/после + оценка на месяц) |
| `add_negative_keywords` | Добавить минус-слова (до 50 за раз) |
| `create_responsive_search_ad` | Создать RSA с заголовками и описаниями (создаётся в PAUSED для проверки) |
| `apply_recommendation` | Применить одну из рекомендаций Google по оптимизации |

### Безопасность

- **По умолчанию только чтение**: в `run_gaql` разрешён только SELECT — CREATE, UPDATE, DELETE, MUTATE и REMOVE заблокированы
- **Движок политик**: каждый вызов API требует вашего подтверждения
- **Ограничение частоты**: 10 вызовов в минуту на инструмент против неконтролируемого использования
- **Санитизация ошибок**: внутренние детали API не показываются — только понятные сообщения
- **Аудит-лог**: каждый вызов пишется в `~/.gemini/logs/google-ads-agent.log`

---

## Получение учётных данных

Нужны **5 значений** из **3 мест**. Настройка один раз.

### Из Google Ads (2 значения)

1. Откройте [ads.google.com](https://ads.google.com)
2. **Tools & Settings** (ключ) → **API Center**
3. Скопируйте **Developer Token**
4. Запишите **Login Customer ID** — ID MCC (менеджерского) аккаунта, 10 цифр вверху страницы (формат: `123-456-7890`)

> **Нет доступа к API?** Нужно [подать заявку на developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). Базовый доступ обычно одобряют за несколько дней.

### Из Google Cloud Console (2 значения)

1. Откройте [console.cloud.google.com](https://console.cloud.google.com)
2. Создайте проект (или выберите существующий)
3. **APIs & Services** → **Library** → найдите «Google Ads API» → **Enable**
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Тип приложения: **Web application**
6. Добавьте `https://developers.google.com/oauthplayground` как разрешённый redirect URI
7. Скопируйте **Client ID** и **Client Secret**

### Из OAuth Playground (1 значение)

1. Откройте [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)
2. **Шестерёнка** (справа сверху) → отметьте **Use your own OAuth credentials**
3. Вставьте **Client ID** и **Client Secret** с предыдущего шага
4. В левой панели найдите **Google Ads API v23** → выберите `https://www.googleapis.com/auth/adwords`
5. **Authorize APIs** → войдите Google-аккаунтом с доступом к Google Ads
6. **Exchange authorization code for tokens**
7. Скопируйте **Refresh Token**

### Ввод учётных данных

```bash
gemini extensions config google-ads-agent
```

Запросит каждое значение. Секретные поля (developer token, client secret, refresh token) хранятся в связке ключей — не в открытом виде.

---

## Команды

Три slash-команды для структурированного анализа:

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
Активируется при вопросах о кампаниях, бюджетах, ключевых словах, объявлениях, PPC, ROAS, ставках или Performance Max. Включает:
- Шаблоны GAQL для типовых отчётов
- Форматирование стоимости (Google использует микроединицы — skill переводит в доллары)
- Пороги аномалий (рост CPA >20%, ноль конверсий, лимиты бюджета)
- Безопасная запись: Подтвердить → Выполнить → Проверка после

### Security Auditor
Активируется при аудите безопасности, поиске секретов или проверке уязвимостей. Включает:
- 10+ шаблонов секретов (sk-, AIzaSy, ghp_, AKIA, xox, whsec_ и т.д.)
- Проверки auth/authz, валидации ввода, обработки ошибок, шифрования
- Уровни серьёзности (Critical / High / Medium / Low)

---

## Структура расширения

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

## Обновление

```bash
gemini extensions update google-ads-agent
```

## Удаление

```bash
gemini extensions uninstall google-ads-agent
```

## Локальная разработка

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

Изменения подхватываются автоматически — переустанавливать не нужно.

## Устранение неполадок

| Проблема | Решение |
|---------|----------|
| `command not found: gemini` | Выполните `npm install -g @google/gemini-cli` |
| `Please set an Auth method` | Создайте `~/.gemini/.env` с `GEMINI_API_KEY=your-key` ([бесплатный ключ](https://aistudio.google.com/apikey)) |
| `Missing Google Ads credentials` | Выполните `gemini extensions config google-ads-agent` |
| `Authentication failed` | Возможно, истёк refresh token — создайте новый в [OAuth Playground](https://developers.google.com/oauthplayground/) |
| `Permission denied` | Убедитесь, что аккаунт доступен под вашим MCC |
| `Rate limit exceeded` | Подождите 60 секунд — лимит 10 вызовов/мин на инструмент |

## См. также

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — Anthropic Agent Skills для Claude (анализ, аудит, запись, расчёты, MCP)
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — Python MCP-сервер с 29 инструментами
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — полный Python-агент: 28 действий API и 6 субагентов
- [googleadsagent.ai](https://googleadsagent.ai) — продакшн-система (Buddy) на Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## Лицензия

MIT
