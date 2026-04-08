# Procurement Labs MCP

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants access to a curated set of external APIs — health data, financial markets, AI models, maps, cloud services, and more — through a single unified interface.

## Architecture Overview

The project has two distinct layers:

**Backend (Vercel serverless)** — lives in `api/`
- `api/mcp.ts` — `POST /api/mcp` — MCP JSON-RPC endpoint (recommended, no local install needed)
- `api/providers.ts` — `GET /api/providers` — REST: list providers
- `api/query.ts` — `POST /api/query` — REST: execute a provider action
- `api/usage.ts` — `GET /api/usage` — REST: account quota and usage breakdown
- `api/_lib/auth.ts` — validates `x-pl-key` headers against a comma-separated allowlist in `PL_VALID_KEYS`
- `api/_lib/providers/` — one class per integration, all implementing the `Provider` interface

**MCP Server (local stdio process)** — lives in `src/` (optional, for older clients)
- Runs on the participant's machine and proxies to the Vercel backend via the REST endpoints
- Only needed if your MCP client doesn't support remote HTTP connections

```
Option A — Remote MCP (recommended)
┌─────────────────────┐   HTTPS + x-pl-key   ┌──────────────────────────────────────┐
│   AI Client         │──────────────────────►│  Vercel Backend                      │
│  (Claude Desktop,   │◄──────────────────────│  POST /api/mcp  ← MCP JSON-RPC       │
│   Cursor, etc.)     │                       │                                      │
└─────────────────────┘                       │  Providers:                          │
                                              │  health:    OpenFDA, Mental Health   │
Option B — Local stdio (legacy)               │  financial: Alpha Vantage            │
┌─────────────────────┐  stdio  ┌──────────┐  │  impact:    Charity/Every.org        │
│   AI Client         │◄───────►│  src/    │  │  env:       OpenWeather              │
│                     │         │  index.ts│  │  ai:        Claude, OpenAI, Gemini,  │
└─────────────────────┘         └────┬─────┘  │             HuggingFace              │
                                     │ HTTPS  │  cloud:     AWS Comprehend, GCloud   │
                                     └───────►│  maps:      Google Maps, OSM         │
                                              └──────────────────────────────────────┘
```

## Setup

### Prerequisites

- Node.js 18+
- A deployed instance of the backend (or run locally with Vercel CLI)

---

### 1. Deploy the Backend

**Option A — Vercel (recommended)**

```bash
npm install -g vercel
vercel deploy
```

In the Vercel dashboard, set environment variables for the providers you want to enable (see [Environment Variables](#environment-variables) below). At minimum you need `PL_VALID_KEYS`.

**Option B — Local with Vercel CLI**

```bash
npm install
cp .env.example .env.local   # fill in your keys
npx vercel dev               # runs on http://localhost:3000
```

---

### 2. Connect Your AI Client

All clients connect to the same remote endpoint — no cloning, no building, no Node.js required.

```
URL:    https://your-app.vercel.app/api/mcp
Header: x-pl-key: pl_your_key_here
```

---

#### Claude Code (CLI)

One command, no file editing:

```bash
claude mcp add procurement-labs --transport http https://your-app.vercel.app/api/mcp --header "x-pl-key: pl_your_key_here"
```

---

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "procurement-labs": {
      "type": "http",
      "url": "https://your-app.vercel.app/api/mcp",
      "headers": {
        "x-pl-key": "pl_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

#### claude.ai (web)

Settings → Integrations → Add custom integration. Paste the URL and set the `x-pl-key` header in the form. No file editing needed.

---

#### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "procurement-labs": {
      "url": "https://your-app.vercel.app/api/mcp",
      "headers": {
        "x-pl-key": "pl_your_key_here"
      }
    }
  }
}
```

Or via UI: Settings → Tools & Integrations → MCP → Add Server.

---

#### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "procurement-labs": {
      "url": "https://your-app.vercel.app/api/mcp",
      "headers": {
        "x-pl-key": "pl_your_key_here"
      }
    }
  }
}
```

Or via UI: Cascade panel → MCP Servers → Configure.

---

#### Cline (VS Code extension)

Best UI of the bunch — no file editing needed:

1. Open the Cline sidebar
2. Click the MCP Servers tab (plug icon)
3. Add Server → select HTTP type
4. Paste `https://your-app.vercel.app/api/mcp` as the URL
5. Add header `x-pl-key: pl_your_key_here`

---

#### Continue.dev

Edit `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "procurement-labs",
      "transport": {
        "type": "http",
        "url": "https://your-app.vercel.app/api/mcp",
        "headers": {
          "x-pl-key": "pl_your_key_here"
        }
      }
    }
  ]
}
```

---

#### OpenAI Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.procurement-labs]
type = "http"
url = "https://your-app.vercel.app/api/mcp"

[mcp_servers.procurement-labs.headers]
x-pl-key = "pl_your_key_here"
```

---

#### OpenAI Responses API (building your own app)

Pass the MCP server directly as a tool in your API call — no config file needed:

```python
response = client.responses.create(
    model="codex-mini-latest",
    tools=[{
        "type": "mcp",
        "server_url": "https://your-app.vercel.app/api/mcp",
        "headers": { "x-pl-key": "pl_your_key_here" }
    }],
    input="What crypto prices are available?"
)
```

---

#### Goose (Block)

Edit `~/.config/goose/config.yaml`:

```yaml
extensions:
  procurement-labs:
    type: mcp
    enabled: true
    transport: http
    url: https://your-app.vercel.app/api/mcp
    headers:
      x-pl-key: pl_your_key_here
```

---

**Fallback — Local stdio (for clients that don't support HTTP MCP)**

```bash
npm install
npm run build
```

```json
{
  "mcpServers": {
    "procurement-labs": {
      "command": "node",
      "args": ["/absolute/path/to/procurementlabs/dist/index.js"],
      "env": {
        "PL_API_KEY": "pl_your_key_here",
        "PL_BACKEND_URL": "https://your-app.vercel.app"
      }
    }
  }
}
```

**Or run locally for development:**

```bash
PL_API_KEY=pl_demo_key_2026 npm run dev
```

---

### 3. Generate an API Key

API keys must start with `pl_`. Generate one:

```bash
node -e "console.log('pl_' + require('crypto').randomBytes(16).toString('hex'))"
```

Add it (comma-separated) to the `PL_VALID_KEYS` environment variable on your backend.

---

## Environment Variables

### Backend (Vercel / `.env.local`)

| Variable | Required | Description |
|---|---|---|
| `PL_VALID_KEYS` | **Yes** | Comma-separated list of valid `pl_` keys |
| `ANTHROPIC_API_KEY` | No | [anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | No | [platform.openai.com](https://platform.openai.com) |
| `GOOGLE_GEMINI_API_KEY` | No | [aistudio.google.com](https://aistudio.google.com) |
| `HUGGINGFACE_API_KEY` | No | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |
| `AWS_ACCESS_KEY_ID` | No | AWS IAM user with Comprehend access |
| `AWS_SECRET_ACCESS_KEY` | No | |
| `AWS_REGION` | No | Default: `us-east-1` |
| `GOOGLE_CLOUD_API_KEY` | No | Translation API enabled |
| `GOOGLE_MAPS_API_KEY` | No | Maps, Places, Directions APIs enabled |
| `ALPHA_VANTAGE_API_KEY` | No | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |
| `FINNHUB_API_KEY` | No | [finnhub.io](https://finnhub.io/dashboard) |
| `GEOAPIFY_API_KEY` | No | [geoapify.com](https://www.geoapify.com/get-started-with-maps-api) |
| `OPENWEATHER_API_KEY` | No | [openweathermap.org](https://openweathermap.org/api) |
| `EVERY_ORG_API_KEY` | No | [partners.every.org](https://partners.every.org) |
| `OPENFDA_API_KEY` | No | Optional — increases rate limits |

Providers without a configured key will appear as `Status: Not configured` in `list_providers` and return a 503 if queried.

### MCP Client — local stdio only (Option B)

| Variable | Required | Description |
|---|---|---|
| `PL_API_KEY` | **Yes** | Your `pl_` key |
| `PL_BACKEND_URL` | No | Override backend URL (default: `https://procurementlabs.vercel.app`) |

Not needed when using the remote HTTP connection (Option A).

---

## Available MCP Tools

### `list_providers`
Browse all providers, optionally filtered by category.

Categories: `physical_health`, `mental_health`, `financial`, `social_impact`, `environment`, `ai`, `maps`, `cloud`

### `get_api_docs`
View the full API integration documentation — authentication, REST endpoints, provider categories, and examples. Accepts an optional `section` parameter to narrow the output:
- `overview` — project summary and base URL
- `authentication` — how to obtain and use `pl_` keys
- `endpoints` — full REST reference with request/response shapes
- `providers` — all provider IDs, categories, and required env vars

Omit `section` to receive the complete documentation in one response.

### `recommend`
Get intelligent recommendations for which provider best fits your needs.

```json
{
  "need": "I need real-time stock prices",
  "priorities": ["speed", "reliability"],
  "budget": "free"
}
```

Scores providers on relevance, your stated priorities, budget, and live availability. Returns ranked results with reasoning, pricing, and rate-limit summaries.

### `compare`
Compare two or more providers side by side on pricing, rate limits, strengths, weaknesses, and best-fit use cases.

```json
{ "provider_ids": ["claude", "gemini"] }
```

---

## REST API Reference

If you are not using MCP and prefer to call the gateway directly via HTTP, use these REST endpoints.

All endpoints require authentication via the `x-pl-key` header.
- **Base URL:** `https://your-app.vercel.app` (or your local environment)
- **Header:** `x-pl-key: pl_your_key_here`

### `GET /api/providers`
List all supported providers and their available actions.

**Query Parameters:**
- `category` (optional) - Filter by `physical_health`, `mental_health`, `financial`, `social_impact`, `environment`, `ai`, `maps`, or `cloud`.

**Response (200 OK):**
```json
{
  "providers": [
    {
      "id": "claude",
      "name": "Anthropic Claude",
      "category": "ai",
      "description": "...",
      "available": true,
      "availableActions": [...]
    }
  ]
}
```

### `POST /api/query`
Execute a specific action against a provider. The gateway handles the provider's native credentials and rate limits transparently.

**Request Body:**
```json
{
  "provider_id": "claude",
  "action": "chat",
  "params": {
    "message": "Summarize this contract clause: ..."
  }
}
```

**Response (200 OK):**
```json
{
  "data": { ... }
}
```
*Note: This endpoint returns an `X-RateLimit-Remaining` header representing your account's remaining quota balance.*

### `GET /api/usage`
Check your account's quota, detailed usage breakdown by provider, and renewal date.

**Response (200 OK):**
```json
{
  "tier": "free",
  "quota": 500,
  "per_minute_rate": 60,
  "used": 150,
  "remaining": 350,
  "resets": "2026-05-01",
  "breakdown": [
    { "provider": "claude", "count": 100 },
    { "provider": "coingecko", "count": 50 }
  ]
}
```

---

## Development

```bash
npm run dev    # run MCP server with tsx (no build step)
npm run build  # compile TypeScript → dist/
npm start      # run compiled server
```

### Adding a Provider

1. Create `api/_lib/providers/my-provider.ts` implementing the `Provider` interface from `types.ts`
2. Register it in `api/_lib/providers/registry.ts`
