export function buildApiDocs(section?: string): string {
  const overview = `# Procurement Labs API — Overview

Procurement Labs is a unified API gateway that gives you access to 15+ external APIs through a single authenticated endpoint. Use the MCP tools to discover and query providers, or call the REST endpoints directly.

**Base URL:** \`https://your-app.vercel.app\`
**Authentication:** Every request requires an \`x-pl-key\` header.`;

  const authentication = `# Authentication

All requests (MCP and REST) require the \`x-pl-key\` header:

\`\`\`
x-pl-key: pl_your_key_here
\`\`\`

Keys must start with \`pl_\`. Generate one:
\`\`\`bash
node -e "console.log('pl_' + require('crypto').randomBytes(16).toString('hex'))"
\`\`\`

Add the generated key to the \`PL_VALID_KEYS\` environment variable on the backend (comma-separated for multiple keys).

**Rate limits** are enforced per key: a per-minute cap and a monthly quota. Check your current balance with \`GET /api/usage\`.`;

  const endpoints = `# REST Endpoints

## GET /api/providers
List all supported providers and their available actions.

**Query params:**
- \`category\` (optional) — filter by \`physical_health\`, \`mental_health\`, \`financial\`, \`social_impact\`, \`environment\`, \`ai\`, \`maps\`, or \`cloud\`

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

  const providers = `# Provider Categories

## physical_health
- **openfda** — FDA drug adverse events, recalls, and labeling data. No API key required (optional key increases rate limits).

## mental_health
- **mental_health** — Mental health crisis resources and support information.

## financial
- **alpha_vantage** — Real-time and historical stock prices, forex, and economic indicators. Requires \`ALPHA_VANTAGE_API_KEY\`.
- **finnhub** — Stock quotes, company financials, earnings calendars. Requires \`FINNHUB_API_KEY\`.
- **coingecko** — Cryptocurrency prices, market cap, and historical data. Free tier available.

## social_impact
- **charity** — Search nonprofits and charities via Every.org. Requires \`EVERY_ORG_API_KEY\`.

## environment
- **environment** — Current weather, forecasts, and air quality via OpenWeather. Requires \`OPENWEATHER_API_KEY\`.

## ai
- **claude** — Anthropic Claude chat and text generation. Requires \`ANTHROPIC_API_KEY\`.
- **openai** — OpenAI GPT chat and text generation. Requires \`OPENAI_API_KEY\`.
- **gemini** — Google Gemini chat and text generation. Requires \`GOOGLE_GEMINI_API_KEY\`.
- **huggingface** — Open-source model inference via HuggingFace. Requires \`HUGGINGFACE_API_KEY\`.

## maps
- **google_maps** — Geocoding, place search, and directions. Requires \`GOOGLE_MAPS_API_KEY\`.
- **geoapify** — Geocoding and routing (free tier available). Requires \`GEOAPIFY_API_KEY\`.
- **openstreetmap** — Free geocoding via Nominatim. No key required.

## cloud
- **aws_comprehend** — NLP: sentiment analysis, entity recognition, key phrases. Requires AWS credentials.
- **google_translate** — Text translation via Google Cloud. Requires \`GOOGLE_CLOUD_API_KEY\`.

Use \`list_providers\` to see live availability (whether the server has each key configured).`;

  const sections: Record<string, string> = { overview, authentication, endpoints, providers };

  if (section && sections[section]) {
    return sections[section];
  }

  return [overview, authentication, endpoints, providers].join("\n\n---\n\n");
}
