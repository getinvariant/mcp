# Procurement Labs MCP

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants access to a curated set of external APIs — health data, financial markets, AI models, maps, cloud services, and more — through a single unified interface.

## Architecture Overview

The project has two distinct layers:

**Backend (Vercel serverless)** — lives in `api/`
- `api/providers.ts` — `GET /api/providers` — lists available providers, optionally filtered by category
- `api/query.ts` — `POST /api/query` — executes an action on a specific provider
- `api/_lib/auth.ts` — validates `x-pl-key` headers against a comma-separated allowlist in `PL_VALID_KEYS`
- `api/_lib/providers/` — one class per integration, all implementing the `Provider` interface

**MCP Server (local stdio process)** — lives in `src/`
- Runs on the participant's machine, connects to Claude Desktop / Cursor / any MCP-compatible client via stdio
- Exposes two MCP tools: `list_providers` and `query`
- Forwards every tool call to the Vercel backend, authenticating with `PL_API_KEY`
- Keeps no secrets locally — API keys for third-party services are only on the backend

```
┌─────────────────────┐         ┌──────────────────────────────────────┐
│   AI Client         │  stdio  │  MCP Server (local)                  │
│  (Claude Desktop,   │◄───────►│  src/index.ts                        │
│   Cursor, etc.)     │         │  tools: list_providers, query         │
└─────────────────────┘         │  authenticates via PL_API_KEY         │
                                └──────────────┬───────────────────────┘
                                               │ HTTPS + x-pl-key
                                               ▼
                                ┌──────────────────────────────────────┐
                                │  Vercel Backend                      │
                                │  GET  /api/providers                 │
                                │  POST /api/query                     │
                                │                                      │
                                │  Providers:                          │
                                │  health:    OpenFDA, Mental Health   │
                                │  financial: Alpha Vantage            │
                                │  impact:    Charity/Every.org        │
                                │  env:       OpenWeather              │
                                │  ai:        Claude, OpenAI, Gemini,  │
                                │             HuggingFace              │
                                │  cloud:     AWS Comprehend, GCloud   │
                                │  maps:      Google Maps, OSM         │
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

### 2. Install & Configure the MCP Server

```bash
npm install
npm run build
```

Add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

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

> `PL_BACKEND_URL` defaults to `https://procurementlabs.vercel.app` if omitted.

**Or run directly for development:**

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
| `OPENWEATHER_API_KEY` | No | [openweathermap.org](https://openweathermap.org/api) |
| `EVERY_ORG_API_KEY` | No | [partners.every.org](https://partners.every.org) |
| `OPENFDA_API_KEY` | No | Optional — increases rate limits |

Providers without a configured key will appear as `Status: Not configured` in `list_providers` and return a 503 if queried.

### MCP Client (local)

| Variable | Required | Description |
|---|---|---|
| `PL_API_KEY` | **Yes** | Your `pl_` key |
| `PL_BACKEND_URL` | No | Override backend URL (default: `https://procurementlabs.vercel.app`) |

---

## Available MCP Tools

### `list_providers`
Browse all providers, optionally filtered by category.

Categories: `physical_health`, `mental_health`, `financial`, `social_impact`, `environment`, `ai`, `maps`, `cloud`

### `query`
Execute an action against a provider.

```json
{
  "provider_id": "claude",
  "action": "chat",
  "params": { "message": "Summarize this contract clause: ..." }
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
