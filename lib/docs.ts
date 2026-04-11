export function buildApiDocs(section?: string): string {
  const overview = `# Procurement Labs — Overview

Procurement Labs is a unified API gateway that gives you access to 15+ external APIs through **one key** and **one endpoint**. Connect via MCP (Model Context Protocol) for tool-based access from any LLM, or call the REST API directly from your code.

**What you get with a single \`pl_\` key:**
- 15+ providers across health, finance, AI, maps, education, and creative
- Built-in rate limiting, quota management, and upstream key rotation
- Provider recommendations and comparison tooling
- Works with Claude, Cursor, Windsurf, or any MCP-compatible client

**Base URL:** \`https://pclabs.dev\`
**Authentication:** Every request requires an \`x-pl-key\` header (or env var \`PL_API_KEY\` for MCP).`;

  const authentication = `# Authentication

All requests (MCP and REST) require the \`x-pl-key\` header:

\`\`\`
x-pl-key: pl_your_key_here
\`\`\`

**Getting a key:**
Sign up at the hosted instance or via \`POST /api/signup\` with your email. An admin can also issue keys via \`POST /api/admin/keys\`.

**For MCP clients (Claude Desktop, Cursor, etc.):**
Set the \`PL_API_KEY\` environment variable:
\`\`\`json
{
  "mcpServers": {
    "procurement-labs": {
      "command": "npx",
      "args": ["-y", "procurement-labs-mcp"],
      "env": {
        "PL_API_KEY": "pl_your_key_here"
      }
    }
  }
}
\`\`\`

**Rate limits** are enforced per key: a per-minute cap and a monthly quota. Check your current balance with \`GET /api/usage\`.`;

  const endpoints = `# REST Endpoints

## GET /api/providers
List all supported providers and their available actions.

**Query params:**
- \`category\` (optional) — filter by \`physical_health\`, \`mental_health\`, \`financial\`, \`social_impact\`, \`environment\`, \`ai\`, \`maps\`, \`education\`, or \`creative\`

**Response:**
\`\`\`json
{
  "providers": [
    {
      "id": "claude",
      "name": "Anthropic Claude",
      "category": "ai",
      "available": true,
      "description": "...",
      "availableActions": [
        {
          "action": "chat",
          "description": "Send a message to Claude",
          "parameters": {
            "message": { "type": "string", "required": true }
          }
        }
      ]
    }
  ]
}
\`\`\`

---

## POST /api/query
Execute an action against a provider. The gateway handles credentials and rate limits transparently.

**Request body:**
\`\`\`json
{
  "provider_id": "claude",
  "action": "chat",
  "params": {
    "message": "Summarize this contract clause: ..."
  }
}
\`\`\`

**Response:**
\`\`\`json
{ "data": { ... } }
\`\`\`

Response also includes an \`X-RateLimit-Remaining\` header with your remaining quota balance.

---

## GET /api/usage
Check your account quota, usage breakdown by provider, and renewal date.

**Response:**
\`\`\`json
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
\`\`\``;

  const providers = `# Provider Catalog

All providers below are registered and callable via \`POST /api/query\` or the MCP \`list_providers\` tool.

## physical_health
- **openfda** — FDA drug adverse events, recalls, and labeling data. No API key required (optional key increases rate limits).
- **nppes** — CMS NPI Registry: search healthcare providers by name, specialty, NPI, or location. No API key required.

## mental_health
- **mental_health** — Curated database of US mental health crisis hotlines, text lines, and resources. No API key required.

## financial
- **finnhub** — Real-time stock quotes, forex rates, company news. 60 calls/min free.
- **coingecko** — Cryptocurrency prices, market cap, trending coins. Works without key; optional key boosts limits.
- **world_bank** — World Bank development indicators (GDP, population, poverty) for 300+ economies. No API key required.

## social_impact
- **charity** — Search nonprofits and charities via Every.org.

## environment
- **environment** — Current weather and air quality via OpenWeather.

## ai
- **claude** — Anthropic Claude chat and text generation.
- **gemini** — Google Gemini chat and text generation.
- **huggingface** — Open-source model inference via HuggingFace.

## maps
- **geoapify** — Geocoding, reverse geocoding, and routing. 3,000 req/day free.

## education
- **open_library** — Search millions of books by title, author, ISBN, or subject via the Internet Archive. No API key required.
- **khan_academy** — Browse Khan Academy's free educational content tree (subjects, courses, units). No API key required.

## creative
- **unsplash** — Search 3M+ royalty-free photos.
- **art_institute** — Search 120,000+ artworks from the Art Institute of Chicago. No API key required.

Use \`list_providers\` to see live availability (whether the server has each provider's key configured).`;

  const multiKey = `# Multi-Key & Rate Limit Routing

For high-throughput deployments, the backend supports **multiple API keys per upstream provider**. Keys are comma-separated in env vars:

\`\`\`
ANTHROPIC_API_KEY=sk-ant-key1,sk-ant-key2,sk-ant-key3
FINNHUB_API_KEY=abc123,def456
\`\`\`

**How routing works:**
1. Keys are selected via round-robin to spread load evenly
2. When a key gets a 429 (rate limited), it enters exponential cooldown (30s → 60s → 120s → 240s, max 5min)
3. The pool automatically skips cooled-down keys and tries the next available one
4. The \`Retry-After\` header from upstream APIs is respected when present
5. A single key still works exactly as before — fully backwards compatible

This is transparent to API consumers. Your \`pl_\` key users don't need to know or do anything differently.`;

  const sections: Record<string, string> = {
    overview,
    authentication,
    endpoints,
    providers,
    "multi-key": multiKey,
  };

  if (section && sections[section]) {
    return sections[section];
  }

  return [overview, authentication, endpoints, providers, multiKey].join(
    "\n\n---\n\n",
  );
}
