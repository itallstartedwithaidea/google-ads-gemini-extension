# Google Ads Agent — Extensión de Gemini CLI

**Idiomas:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [中文](README.zh.md) · [Nederlands](README.nl.md) · [Русский](README.ru.md) · [한국어](README.ko.md)

Una extensión de [Gemini CLI](https://github.com/google-gemini/gemini-cli) que te da **acceso en vivo a la API de Google Ads** desde la terminal. Pregunta por tus campañas, detecta gasto desperdiciado, audita cuentas y obtén recomendaciones de optimización, todo mediante conversación natural.

<img width="1196" height="1058" alt="image" src="https://github.com/user-attachments/assets/ab7b2dbf-6cdc-41ef-94b0-0288f87f3b4a" />


Construida a partir de la experiencia en producción de un agente de Google Ads con IA en [googleadsagent.ai](https://googleadsagent.ai): 28 acciones personalizadas de la API, 6 subagentes y gestión de cuentas reales de Google Ads mediante la API de Google Ads v22.


<img width="1392" height="928" alt="image" src="https://github.com/user-attachments/assets/377c8d23-acc9-4f05-a0b6-95f3667cf12d" />

---

## Inicio rápido (5 minutos)

### Paso 1: Instala Node.js (si no lo tienes)

```bash
# Check if you already have it
node --version

# If not, install via Homebrew (macOS)
brew install node

# Or download from https://nodejs.org (Windows/Linux/macOS)
```

### Paso 2: Instala Gemini CLI

```bash
npm install -g @google/gemini-cli
```

### Paso 3: Obtén una clave API de Gemini (gratis)

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Haz clic en **Create API Key**
3. Cópiala y guárdala:

```bash
mkdir -p ~/.gemini
echo 'GEMINI_API_KEY=your-key-here' > ~/.gemini/.env
```

El nivel gratuito ofrece 60 solicitudes por minuto y 1.000 al día, más que suficiente.

### Paso 4: Instala esta extensión

```bash
gemini extensions install https://github.com/itallstartedwithaidea/google-ads-gemini-extension
```

Se te pedirá confirmar la instalación e introducir tus credenciales de Google Ads (consulta [Obtener credenciales](#obtener-credenciales) más abajo). Los valores sensibles se guardan en el llavero del sistema.

### Paso 5: Empieza a usarla

```bash
gemini
```

Eso es todo. La extensión se carga sola cada vez. Solo empieza a hacer preguntas:

```
> Show me my Google Ads accounts
> How are my campaigns performing this month?
> Which search terms are wasting money?
> Run an account health check on account 1234567890
> What's my ROAS if I spent $5,000 and made $18,000?
```

---

## Ejemplos de uso

Una vez instalada, escribe `gemini` para abrir el CLI interactivo. Esto es lo que puedes hacer:

### Preguntar por tus cuentas (API en vivo)

```
> List my Google Ads accounts
> Show campaign performance for account 1234567890 for the last 30 days
> What keywords have low quality scores?
> Show me device performance breakdown — mobile vs desktop
> Compare this month vs last month
> What changes were made to my account recently?
```

### Encontrar problemas

```
> Run an account health check — flag anything critical
> Show me search terms with clicks but zero conversions
> Which campaigns are budget-limited?
> What's my impression share? How much traffic am I missing?
```

### Realizar cambios (API en vivo: se requiere confirmación)

```
> Pause campaign 123456789 on account 1234567890
> Enable that campaign again
> Update the daily budget to $75 for that campaign
> Change the CPC bid to $2.50 on ad group 987654321
> Add negative keywords "free, cheap, diy" to campaign 123456789
> Create a responsive search ad for ad group 987654321
> Apply that recommendation Google suggested
```

### Hacer cálculos (sin credenciales de la API)

```
> I spend $75/day, CPC is $1.80, conversion rate is 3.5% — project my month
> Calculate my ROAS: $5,000 spend, $18,500 revenue
> What's my CPA if I spent $3,000 on 42 conversions?
> I have 60% impression share with 10,000 impressions — what am I missing?
```

### Comandos con barra

```
/google-ads:analyze "Brand Search campaign last 30 days"
/google-ads:audit "full account, focus on wasted spend"
/google-ads:optimize "improve ROAS for ecommerce campaigns"
```

### Cambiar de tema

```
/theme google-ads          # Dark theme with Google's color palette
/theme google-ads-light    # Light theme matching Google Ads UI
```

---

## Qué incluye

Esta extensión cubre todos los tipos de funciones del formato de extensiones de Gemini CLI:

| Función | Qué incluye |
|---------|----------------|
| **Servidor MCP** | 22 herramientas: 15 de lectura y 7 de escritura con acceso en vivo a la API de Google Ads |
| **Comandos** | `/google-ads:analyze`, `/google-ads:audit`, `/google-ads:optimize` |
| **Skills** | `google-ads-agent` (experiencia en PPC + plantillas GAQL) y `security-auditor` (búsqueda de vulnerabilidades) |
| **Contexto** | `GEMINI.md`: referencia persistente de la API cargada en cada sesión |
| **Hooks** | Bloqueo de escritura GAQL y registro de auditoría en cada llamada a herramienta |
| **Políticas** | Confirmación del usuario antes de ejecutar cualquier llamada a la API |
| **Temas** | `google-ads` (oscuro) y `google-ads-light` (claro) |
| **Ajustes** | 5 campos de credenciales con almacenamiento en el llavero del sistema para valores sensibles |

---

## Servidor MCP: 22 herramientas

### Herramientas de lectura (15)

Consultan tus cuentas de Google Ads:

| Herramienta | Descripción |
|------|-------------|
| `list_accounts` | Lista todas las cuentas bajo tu MCC |
| `campaign_performance` | Gasto, conversiones, clics, impresiones, CTR, CPC, CPA |
| `search_terms_report` | Análisis de términos de búsqueda con detección de gasto desperdiciado |
| `keyword_quality` | Puntuaciones de calidad con desglose (creatividad, página de destino, CTR esperado) |
| `ad_performance` | Rendimiento creativo de anuncios y puntuaciones de fuerza RSA |
| `budget_analysis` | Asignación de presupuesto, eficiencia y campañas limitadas por presupuesto |
| `geo_performance` | Rendimiento por ubicación geográfica |
| `device_performance` | Rendimiento por dispositivo: móvil, escritorio, tableta |
| `impression_share` | Cuota de impresiones y oportunidad perdida por presupuesto o posición |
| `change_history` | Cambios recientes en la cuenta: quién cambió qué y cuándo |
| `list_recommendations` | Recomendaciones de optimización de Google con impacto estimado |
| `compare_performance` | Comparación entre periodos con diferencias (p. ej., este mes vs el anterior) |
| `calculate` | Matemáticas de Google Ads: proyecciones de presupuesto, ROAS, CPA, previsiones de conversiones |
| `run_gaql` | Consultas GAQL personalizadas (solo lectura: todas las escrituras bloqueadas) |
| `account_health` | Comprobación rápida de salud con detección automática de anomalías |

### Herramientas de escritura (7)

Modifican tu cuenta de Google Ads. **Cada herramienta de escritura requiere tu confirmación explícita antes de ejecutarse.**

| Herramienta | Descripción |
|------|-------------|
| `pause_campaign` | Pausar una campaña activa (muestra primero el estado actual) |
| `enable_campaign` | Volver a activar una campaña pausada |
| `update_bid` | Cambiar la puja CPC de un grupo de anuncios (antes y después) |
| `update_budget` | Cambiar el presupuesto diario de una campaña (antes y después + estimación mensual) |
| `add_negative_keywords` | Añadir palabras clave negativas para bloquear términos no deseados (hasta 50 a la vez) |
| `create_responsive_search_ad` | Crear una RSA nueva con titulares y descripciones (creada en PAUSED para revisión) |
| `apply_recommendation` | Aplicar una de las sugerencias de optimización de Google |

### Seguridad

- **Solo lectura por defecto**: `run_gaql` solo permite consultas SELECT; CREATE, UPDATE, DELETE, MUTATE y REMOVE están bloqueados
- **Motor de políticas**: cada herramienta de la API requiere tu confirmación antes de ejecutarse
- **Limitación de frecuencia**: 10 llamadas por minuto por herramienta para evitar usos descontrolados
- **Sanitización de errores**: no se exponen detalles internos de la API; recibes mensajes claros y accionables
- **Registro de auditoría**: cada llamada a herramienta se guarda en `~/.gemini/logs/google-ads-agent.log`

---

## Obtener credenciales

Necesitas **5 valores** de **3 sitios**. Es una configuración única.

### Desde Google Ads (2 valores)

1. Ve a [ads.google.com](https://ads.google.com)
2. Haz clic en **Tools & Settings** (icono de llave inglesa) → **API Center**
3. Copia tu **Developer Token**
4. Anota tu **Login Customer ID**: es el ID de tu cuenta MCC (Manager), el número de 10 dígitos en la parte superior (formato: `123-456-7890`)

> **¿Sin acceso a la API?** Deberás [solicitar un developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). El acceso básico suele aprobarse en unos días.

### Desde Google Cloud Console (2 valores)

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Crea un proyecto (o selecciona uno existente)
3. Ve a **APIs & Services** → **Library** → busca «Google Ads API» → **Enable**
4. Ve a **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Elige **Web application** como tipo de aplicación
6. Añade `https://developers.google.com/oauthplayground` como URI de redirección autorizada
7. Copia tu **Client ID** y **Client Secret**

### Desde OAuth Playground (1 valor)

1. Ve a [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/)
2. Haz clic en el **icono de engranaje** (arriba a la derecha) → marca **Use your own OAuth credentials**
3. Pega tu **Client ID** y **Client Secret** del paso anterior
4. En el panel izquierdo, busca **Google Ads API v22** → selecciona `https://www.googleapis.com/auth/adwords`
5. Haz clic en **Authorize APIs** → inicia sesión con la cuenta de Google que tenga acceso a Google Ads
6. Haz clic en **Exchange authorization code for tokens**
7. Copia el **Refresh Token**

### Introducir tus credenciales

```bash
gemini extensions config google-ads-agent
```

Te pedirá cada valor. Los campos sensibles (developer token, client secret, refresh token) se guardan en el llavero del sistema, no en texto plano.

---

## Comandos

Tres comandos con barra para análisis estructurado:

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
Se activa automáticamente cuando preguntas por campañas, presupuestos, palabras clave, anuncios, PPC, ROAS, pujas o Performance Max. Incluye:
- Plantillas de consulta GAQL para informes habituales
- Formato de costes (Google usa micros; la skill convierte a dólares)
- Umbrales de detección de anomalías (picos de CPA >20 %, cero conversiones, límites de presupuesto)
- Protocolo seguro de escritura: Confirmar → Ejecutar → Comprobación posterior

### Security Auditor
Se activa cuando pides auditar seguridad, buscar secretos o comprobar vulnerabilidades. Incluye:
- Más de 10 patrones de secretos (sk-, AIzaSy, ghp_, AKIA, xox, whsec_, etc.)
- Comprobaciones de auth/authz, validación de entradas, manejo de errores y cifrado
- Marco de gravedad (Critical / High / Medium / Low)

---

## Estructura de la extensión

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

## Actualizar

```bash
gemini extensions update google-ads-agent
```

## Desinstalar

```bash
gemini extensions uninstall google-ads-agent
```

## Desarrollo local

```bash
git clone https://github.com/itallstartedwithaidea/google-ads-gemini-extension.git
cd google-ads-gemini-extension
npm install
gemini extensions link .
```

Los cambios se recargan solos; no hace falta reinstalar.

## Solución de problemas

| Problema | Solución |
|---------|----------|
| `command not found: gemini` | Ejecuta `npm install -g @google/gemini-cli` |
| `Please set an Auth method` | Crea `~/.gemini/.env` con `GEMINI_API_KEY=your-key` ([obtener una gratis](https://aistudio.google.com/apikey)) |
| `Missing Google Ads credentials` | Ejecuta `gemini extensions config google-ads-agent` |
| `Authentication failed` | Tu refresh token puede haber caducado; regenéralo en [OAuth Playground](https://developers.google.com/oauthplayground/) |
| `Permission denied` | Asegúrate de que la cuenta sea accesible bajo tu MCC |
| `Rate limit exceeded` | Espera 60 segundos; la extensión limita a 10 llamadas/min por herramienta |

## Relacionado

- [google-ads-skills](https://github.com/itallstartedwithaidea/google-ads-skills) — Anthropic Agent Skills para Claude (análisis, auditoría, escritura, matemáticas, MCP)
- [google-ads-mcp](https://github.com/itallstartedwithaidea/google-ads-mcp) — Servidor MCP en Python con 29 herramientas
- [google-ads-api-agent](https://github.com/itallstartedwithaidea/google-ads-api-agent) — Agente Python completo con 28 acciones de API y 6 subagentes
- [googleadsagent.ai](https://googleadsagent.ai) — Sistema en producción (Buddy) en Cloudflare
- [Gemini CLI Extension Docs](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extension Gallery](https://geminicli.com/extensions/browse/)

## Licencia

MIT
