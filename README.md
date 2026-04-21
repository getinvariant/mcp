# Invariant

**The agentic API provisioning layer.** Your AI agent gets weather, stocks, health data, maps, and frontier LLMs from a single endpoint. invariant creates the accounts, manages the keys, enforces the quotas, and falls back when something breaks. You never touch a developer portal.

> One key in. Every API out.

## Why invariant exists

A useful AI agent needs to call ten different services. An LLM, a weather API, a stock ticker, a geocoder, a health database, a charity lookup. Building that today means:

- Ten developer portals, ten signup forms, ten email confirmations
- Ten API keys to rotate and secure
- Ten different auth schemes, rate limits, and error shapes
- Ten ways for a single call to fail, and no fallback when one does

invariant collapses all of it into one managed layer. You connect once over MCP or REST, and the provisioning, routing, quota accounting, and failover happen above your agent.

## Provider catalog

| Provider                | Category        | Rate Limit    | Key needed?      |
| ----------------------- | --------------- | ------------- | ---------------- |
| OpenFDA                 | Physical Health | 240 req/min   | No               |
| Mental Health Resources | Mental Health   | unlimited     | No               |
| **CoinGecko**           | Finance         | ~50 req/min   | No               |
| **Finnhub**             | Finance         | 60 req/min    | Free signup      |
| Every.org               | Social Impact   | generous      | Free signup      |
| OpenWeatherMap          | Environment     | 60 req/min    | Free signup      |
| Anthropic Claude        | AI              | .             | Paid             |
| Google Gemini           | AI              | 1,500 req/day | Free (AI Studio) |
| HuggingFace             | AI              | generous      | Free signup      |
| **Geoapify**            | Maps            | 3,000 req/day | Free, no card    |

On the hosted instance invariant handles every "Free signup" row for you. You never see those portals. Self-hosted instances can bring their own keys via environment variables.

## How it works

```
         ┌─────────────────────┐
         │    Your AI Agent    │
         │  (Claude, Cursor,   │
         │   Codex, custom)    │
         └──────────┬──────────┘
                    │ MCP (JSON-RPC) or REST
                    │ single key: x-pl-key
                    ▼
         ┌─────────────────────────────────┐
         │            invariant              │
         │  ┌───────────────────────────┐  │
         │  │  auth + quota             │  │
         │  │  (Supabase + Upstash)     │  │
         │  ├───────────────────────────┤  │
         │  │  reasoning layer          │  │
         │  │  (recommend / compare)    │  │
         │  ├───────────────────────────┤  │
         │  │  provider router + fall-  │  │
         │  │  back + usage logging     │  │
         │  └───────────────────────────┘  │
         └──────────┬──────────────────────┘
                    │ managed upstream credentials
                    ▼
  OpenFDA . Mental Health . CoinGecko . Finnhub . Every.org
  OpenWeatherMap . Anthropic . Gemini . HuggingFace . Geoapify
```

## Access modes

invariant exposes the same engine through two interfaces.

**1. MCP (recommended for AI clients).** JSON-RPC over HTTP at `POST /api/mcp`. Works with Claude Desktop, Cursor, Claude Code, Windsurf, Cline, Continue.dev, Codex CLI, Goose, and the OpenAI Responses API.

**2. REST (for custom code).** Plain HTTP endpoints if you are building your own integration:

| Endpoint         | Method | Purpose                                                  |
| ---------------- | ------ | -------------------------------------------------------- |
| `/api/providers` | GET    | List every provider and its status                       |
| `/api/query`     | POST   | Execute an action on a provider                          |
| `/api/recommend` | POST   | Ask invariant to pick the best provider for a goal         |
| `/api/usage`     | GET    | Your current quota, tier, and per-provider breakdown     |
| `/api/mcp`       | POST   | MCP JSON-RPC endpoint (same tools, agent-friendly shape) |

Every endpoint requires an `x-pl-key: pl_...` header.

## Getting started

### 1. Get your invariant key

Sign up at the hosted instance. You get one `pl_...` key. That is the only credential you ever see. Behind it, invariant is already holding every upstream account for you.

### 2. Connect your AI client

All clients connect to the same remote endpoint. No cloning, no building, no Node.js required.

```
URL:    https://pclabs.dev/api/mcp
Header: x-pl-key: pl_your_key_here
```

#### Claude Code (CLI)

```bash
claude mcp add invariant --transport http https://pclabs.dev/api/mcp --header "x-pl-key: pl_your_key_here"
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "invariant": {
      "type": "http",
      "url": "https://pclabs.dev/api/mcp",
      "headers": {
        "x-pl-key": "pl_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

#### claude.ai (web)

Settings → Integrations → Add custom integration. Paste the URL and set the `x-pl-key` header in the form. No file editing.

#### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "invariant": {
      "url": "https://pclabs.dev/api/mcp",
      "headers": {
        "x-pl-key": "pl_your_key_here"
      }
    }
  }
}
```

Or via UI: Settings → Tools & Integrations → MCP → Add Server.

#### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "invariant": {
      "url": "https://pclabs.dev/api/mcp",
      "headers": {
        "x-pl-key": "pl_your_key_here"
      }
    }
  }
}
```

Or via UI: Cascade panel → MCP Servers → Configure.

#### Cline (VS Code extension)

1. Open the Cline sidebar
2. Click the MCP Servers tab (plug icon)
3. Add Server → HTTP
4. Paste `https://pclabs.dev/api/mcp` as the URL
5. Add header `x-pl-key: pl_your_key_here`

#### Continue.dev

Edit `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "invariant",
      "transport": {
        "type": "http",
        "url": "https://pclabs.dev/api/mcp",
        "headers": {
          "x-pl-key": "pl_your_key_here"
        }
      }
    }
  ]
}
```

#### OpenAI Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.invariant]
type = "http"
url = "https://pclabs.dev/api/mcp"

[mcp_servers.invariant.headers]
x-pl-key = "pl_your_key_here"
```

#### OpenAI Responses API

Pass the MCP server directly as a tool:

```python
response = client.responses.create(
    model="codex-mini-latest",
    tools=[{
        "type": "mcp",
        "server_url": "https://pclabs.dev/api/mcp",
        "headers": { "x-pl-key": "pl_your_key_here" }
    }],
    input="What crypto prices are available?"
)
```

#### Goose (Block)

Edit `~/.config/goose/config.yaml`:

```yaml
extensions:
  invariant:
    type: mcp
    enabled: true
    transport: http
    url: https://pclabs.dev/api/mcp
    headers:
      x-pl-key: pl_your_key_here
```

## MCP tools

The MCP endpoint exposes four tools.

### `recommend`

Describe what you need. invariant returns ranked providers with scores, reasoning, pricing, and availability. This is the agentic entry point. Agents should start here, not with `query`.

```json
{
  "need": "real-time crypto prices with no signup",
  "priorities": ["no-auth", "cost"],
  "budget": "free"
}
```

### `compare`

Side-by-side comparison of two or more providers on pricing, rate limits, strengths, and weaknesses.

```json
{ "provider_ids": ["claude", "gemini"] }
```

### `list_providers`

Browse the catalog, optionally filtered by category: `physical_health`, `mental_health`, `financial`, `social_impact`, `environment`, `ai`, `maps`.

### `query`

Execute a specific action against a specific provider. The low-level primitive that `recommend` ultimately calls into.

```json
{
  "provider_id": "coingecko",
  "action": "price",
  "params": { "ids": "bitcoin", "vs_currencies": "usd" }
}
```

## Self-hosting

You can run your own invariant instance if you want to bring your own upstream credentials or host on your own infrastructure.

### Prerequisites

- Node.js 18+
- A Supabase project for accounts and usage logging. See [migration.sql](migration.sql) for the schema.
- An Upstash Redis instance for per-minute rate limiting

### Deploy to Railway

invariant runs as a single Node HTTP server defined in [dev-server.ts](dev-server.ts), which mounts the route handlers in [api/](api/) plus the admin, signup, and waitlist routes. Railway auto-detects the `start` script, so no `railway.toml` or `Procfile` is required.

```bash
npm install
npm run build
npm start     # runs dist/dev-server.js on $PORT
```

Point Railway at this repo and set the environment variables below in the Railway dashboard.

### Environment variables

**Platform (required):**

| Variable                   | Description                                  |
| -------------------------- | -------------------------------------------- |
| `SUPABASE_URL`             | Supabase project URL                         |
| `SUPABASE_SERVICE_KEY`     | Supabase service role key (server-side only) |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis REST URL                       |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token                     |
| `ADMIN_PASSWORD`           | Password gate for the admin API endpoints    |

**Upstream providers (optional). Omit a variable to disable that provider:**

| Variable                | Provider                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | Anthropic Claude ([console.anthropic.com](https://console.anthropic.com))              |
| `GOOGLE_GEMINI_API_KEY` | Google Gemini ([aistudio.google.com](https://aistudio.google.com))                     |
| `HUGGINGFACE_API_KEY`   | HuggingFace ([huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)) |
| `FINNHUB_API_KEY`       | Finnhub ([finnhub.io](https://finnhub.io))                                             |
| `COINGECKO_API_KEY`     | CoinGecko. Optional, boosts rate limit.                                                |
| `EVERY_ORG_API_KEY`     | Every.org ([partners.every.org](https://partners.every.org))                           |
| `OPENWEATHER_API_KEY`   | OpenWeatherMap ([openweathermap.org/api](https://openweathermap.org/api))              |
| `GEOAPIFY_API_KEY`      | Geoapify ([myprojects.geoapify.com](https://myprojects.geoapify.com))                  |
| `OPENFDA_API_KEY`       | OpenFDA. Optional, boosts rate limit.                                                  |

Providers without a configured key show `Status: Not configured` in `list_providers` and return a 503 when queried. OpenFDA and Mental Health Resources work with no key at all.

### Provisioning keys

Keys live in Supabase, not in an env var. Apply [migration.sql](migration.sql) to your project to create the `accounts` and `usage` tables, then create accounts through the admin endpoints (gated by `ADMIN_PASSWORD`) or by inserting rows directly. Each account row holds a `pl_...` key, a tier, a monthly quota, and a per-minute rate.

### Local development

```bash
cp .env.example .env          # fill in your values
npm install
npx tsx dev-server.ts         # HTTP server with hot-restart via tsx
```

The server listens on `$PORT` (defaults to 3000). Hit `http://localhost:3000/api/providers` with your `x-pl-key` header to sanity check.

To run the stdio MCP fallback instead (see below), use `npm run dev`.

### Fallback: local stdio MCP

For MCP clients that cannot speak HTTP, the repo also ships a thin stdio proxy in [src/](src/) that forwards to a remote invariant backend:

```bash
npm install
npm run build
```

```json
{
  "mcpServers": {
    "invariant": {
      "command": "node",
      "args": ["/absolute/path/to/invariant/dist/index.js"],
      "env": {
        "PL_API_KEY": "pl_your_key_here",
        "PL_BACKEND_URL": "https://pclabs.dev/api/mcp"
      }
    }
  }
}
```

MCP client env vars for the stdio path:

| Variable         | Required | Description                                                 |
| ---------------- | -------- | ----------------------------------------------------------- |
| `PL_API_KEY`     | Yes      | Your `pl_` key                                              |
| `PL_BACKEND_URL` | No       | Override backend URL. Default: `https://pclabs.dev/api/mcp` |

## Adding a provider

1. Create `lib/providers/my-provider.ts` implementing the `Provider` interface from [lib/providers/types.ts](lib/providers/types.ts)
2. Register it in [lib/providers/registry.ts](lib/providers/registry.ts)
3. Add any required env vars to [.env.example](.env.example)
4. Add metadata to [lib/reasoning/](lib/reasoning/) so the `recommend` tool can surface it

## Scripts

```bash
npm run dev    # stdio MCP server via tsx, no build
npm run build  # compile TypeScript → dist/
npm start      # run compiled standalone server (dist/dev-server.js)
npm test       # run test.ts against local backend
```

---

Built on [MCP](https://modelcontextprotocol.io), Hono, Supabase, and Upstash Redis.
