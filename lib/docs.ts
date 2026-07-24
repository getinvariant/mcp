import { getAllProviders } from "./providers/registry.js";

/**
 * Group providers by category + source for the catalog section. We collapse
 * aggregator-sourced providers (OpenRouter, HuggingFace, Replicate, Fal,
 * Together, APILayer) into a per-source line item so the doc doesn't dump
 * 1,600 model names. Hand-written providers are listed individually because
 * each has distinct actions worth knowing.
 */
function buildProvidersSection(): string {
  const all = getAllProviders();
  const ready = all.filter((p) => p.isAvailable());

  // Bucket: aggregator-sourced grouped by source, others individually by category.
  const aggregatorCounts: Record<string, { total: number; ready: number; sample: string[] }> = {};
  const individual: { category: string; line: string; ready: boolean }[] = [];

  for (const p of all) {
    const isAggregator = /^(openrouter|hf|replicate|fal|together|apilayer)_/.test(p.info.id);
    if (isAggregator) {
      const source = p.info.id.split("_")[0];
      if (!aggregatorCounts[source]) aggregatorCounts[source] = { total: 0, ready: 0, sample: [] };
      aggregatorCounts[source].total++;
      if (p.isAvailable()) aggregatorCounts[source].ready++;
      if (aggregatorCounts[source].sample.length < 4) {
        aggregatorCounts[source].sample.push(p.info.name);
      }
    } else {
      individual.push({
        category: p.info.category,
        line: `- **${p.info.id}** (${p.isAvailable() ? "ready" : "needs key"}) — ${p.info.description}`,
        ready: p.isAvailable(),
      });
    }
  }

  const byCategory = individual.reduce<Record<string, string[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p.line);
    return acc;
  }, {});

  const categoryBlocks = Object.entries(byCategory)
    .map(([cat, lines]) => `## ${cat}\n${lines.join("\n")}`)
    .join("\n\n");

  const aggregatorBlock = Object.entries(aggregatorCounts).length
    ? `\n\n## ai (aggregator-fronted)\n` +
      Object.entries(aggregatorCounts)
        .map(
          ([source, { total, ready, sample }]) =>
            `- **${source}** — ${ready}/${total} providers ready. Examples: ${sample.join(", ")}.\n  Provider ids: \`${source}_*\` (e.g. \`${source}_${sample[0]?.replace(/[\/:.]/g, "_").toLowerCase().slice(0, 40)}\`)`,
        )
        .join("\n")
    : "";

  const supportedCategories = [
    "Text generation: OpenRouter, HuggingFace, Together, Anthropic, Gemini",
    "Image generation: Fal (FLUX, SDXL, Recraft, Ideogram), Replicate (community models)",
    "Video generation: Fal (Luma, Kling, Runway, Mochi, HunyuanVideo)",
    "Audio / speech: Fal (Whisper, ElevenLabs, Cartesia), Replicate (Whisper, MusicGen)",
    "Embeddings: Together, HuggingFace",
    "Geocoding + maps: openstreetmap, geoapify, mapbox",
    "Stock / crypto: finnhub, coingecko, binance, alpha_vantage",
    "Weather: open_meteo, environment",
    "News + sentiment + currency + scraping: apilayer_*",
    "Health + government data: openfda, nppes, world_bank",
    "Education + creative: open_library, khan_academy, unsplash, art_institute",
  ];

  return [
    `# Provider Catalog`,
    ``,
    `**${ready.length} of ${all.length} providers ready** (have keys configured). Call via \`POST /api/query\` or MCP \`list_providers\`.`,
    ``,
    `## What Invariant CAN do`,
    supportedCategories.map((s) => `- ${s}`).join("\n"),
    ``,
    `## Individual providers (hand-written)`,
    categoryBlocks,
    aggregatorBlock,
    ``,
    `Tip: use \`list_providers\` for the full live catalog with action signatures.`,
  ].join("\n");
}

export function buildApiDocs(section?: string): string {
  const overview = `# Invariant — Overview

Invariant is a unified API gateway that gives you access to 15+ external APIs through **one key** and **one endpoint**. Connect via MCP (Model Context Protocol) for tool-based access from any LLM, or call the REST API directly from your code.

**What you get with a single \`pl_\` key:**
- 15+ providers across health, finance, AI, maps, education, and creative
- Built-in rate limiting, quota management, and upstream key rotation
- Provider recommendations and comparison tooling
- Works with Claude, Cursor, Windsurf, or any MCP-compatible client

**Base URL:** \`https://getinvariant.com\`
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
    "invariant": {
      "command": "npx",
      "args": ["-y", "invariant-mcp"],
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

  const providers = buildProvidersSection();

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
