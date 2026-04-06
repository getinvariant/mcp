#!/usr/bin/env tsx
/**
 * Procurement Labs — Comprehensive API Test Script
 * Usage:
 *   Local:  PL_API_KEY=pl_demo_key_2026 PL_BACKEND_URL=http://localhost:3000 npx tsx test.ts
 *   Prod:   PL_API_KEY=pl_demo_key_2026 PL_BACKEND_URL=https://your-app.vercel.app npx tsx test.ts
 */

const BASE_URL = process.env.PL_BACKEND_URL || "http://localhost:3000";
const PL_KEY = process.env.PL_API_KEY || "pl_demo_key_2026";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;
let skipped = 0;

async function apiGet(path: string, key = PL_KEY) {
  const res = await fetch(`${BASE_URL}/api/${path}`, {
    headers: { "x-pl-key": key },
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function apiPost(body: object, key = PL_KEY) {
  const res = await fetch(`${BASE_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pl-key": key },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

function pass(name: string, detail?: string) {
  passed++;
  console.log(`  ${GREEN}✓${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ""}`);
}

function fail(name: string, detail?: string) {
  failed++;
  console.log(`  ${RED}✗${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ""}`);
}

function skip(name: string, reason: string) {
  skipped++;
  console.log(`  ${YELLOW}−${RESET} ${name} ${DIM}(skipped: ${reason})${RESET}`);
}

function section(name: string) {
  console.log(`\n${BOLD}${CYAN}${name}${RESET}`);
}

async function test(
  name: string,
  fn: () => Promise<{ status: number; body: any }>,
  check: (res: { status: number; body: any }) => { ok: boolean; detail?: string },
  skipReason?: string
) {
  if (skipReason) {
    skip(name, skipReason);
    return;
  }
  try {
    const res = await fn();
    const { ok, detail } = check(res);
    if (ok) pass(name, detail);
    else fail(name, detail || JSON.stringify(res.body).slice(0, 120));
  } catch (err) {
    fail(name, (err as Error).message);
  }
}

// --- Detect which providers are configured ---
let availableProviders: string[] = [];

async function detectAvailable() {
  try {
    const { body } = await apiGet("providers");
    availableProviders = (body.providers || [])
      .filter((p: any) => p.available)
      .map((p: any) => p.id);
  } catch {}
}

function available(id: string): string | undefined {
  return availableProviders.includes(id) ? undefined : `${id} API key not configured`;
}

// ============================================================
// TESTS
// ============================================================

async function main() {
  console.log(`\n${BOLD}Procurement Labs — API Test Suite${RESET}`);
  console.log(`${DIM}Backend: ${BASE_URL}${RESET}`);
  console.log(`${DIM}Key:     ${PL_KEY.slice(0, 12)}...${RESET}`);

  // --- Auth ---
  section("Auth");

  await test(
    "Rejects missing API key",
    () => apiGet("providers", ""),
    ({ status }) => ({ ok: status === 401, detail: `HTTP ${status}` })
  );

  await test(
    "Rejects invalid API key",
    () => apiGet("providers", "pl_invalid_key_abc"),
    ({ status }) => ({ ok: status === 401, detail: `HTTP ${status}` })
  );

  await test(
    "Accepts valid API key",
    () => apiGet("providers"),
    ({ status }) => ({ ok: status === 200, detail: `HTTP ${status}` })
  );

  // --- Provider Discovery ---
  section("Provider Discovery");

  await detectAvailable();

  await test(
    "GET /api/providers returns list",
    () => apiGet("providers"),
    ({ status, body }) => ({
      ok: status === 200 && Array.isArray(body.providers),
      detail: `${body.providers?.length} providers`,
    })
  );

  await test(
    "Filter by category: ai",
    () => apiGet("providers?category=ai"),
    ({ status, body }) => ({
      ok: status === 200 && body.providers?.every((p: any) => p.category === "ai"),
      detail: `${body.providers?.length} ai providers`,
    })
  );

  await test(
    "Filter by category: maps",
    () => apiGet("providers?category=maps"),
    ({ status, body }) => ({
      ok: status === 200 && body.providers?.every((p: any) => p.category === "maps"),
      detail: `${body.providers?.length} maps providers`,
    })
  );

  await test(
    "Unknown provider returns 404",
    () => apiPost({ provider_id: "does_not_exist", action: "test", params: {} }),
    ({ status }) => ({ ok: status === 404 })
  );

  // --- Physical Health: OpenFDA ---
  section("OpenFDA (Physical Health)");

  await test(
    "drug_search: ibuprofen",
    () => apiPost({ provider_id: "openfda", action: "drug_search", params: { query: "ibuprofen", limit: 2 } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` })
  );

  await test(
    "adverse_events: aspirin",
    () => apiPost({ provider_id: "openfda", action: "adverse_events", params: { drug: "aspirin", limit: 2 } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` })
  );

  await test(
    "recalls: contamination",
    () => apiPost({ provider_id: "openfda", action: "recalls", params: { query: "contamination", limit: 2 } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` })
  );

  await test(
    "Missing required param returns error",
    () => apiPost({ provider_id: "openfda", action: "drug_search", params: {} }),
    ({ status }) => ({ ok: status === 502 })
  );

  // --- Mental Health ---
  section("Mental Health Resources");

  await test(
    "crisis_resources: all",
    () => apiPost({ provider_id: "mental_health", action: "crisis_resources", params: {} }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} resources` })
  );

  await test(
    "crisis_resources: filter by type=hotline",
    () => apiPost({ provider_id: "mental_health", action: "crisis_resources", params: { type: "hotline" } }),
    ({ status, body }) => ({
      ok: status === 200 && body.data?.every((r: any) => r.type === "hotline"),
      detail: `${body.data?.length} hotlines`,
    })
  );

  await test(
    "resource_search: veterans",
    () => apiPost({ provider_id: "mental_health", action: "resource_search", params: { keyword: "veterans" } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.length > 0, detail: `${body.data?.length} results` })
  );

  await test(
    "resource_search: anxiety",
    () => apiPost({ provider_id: "mental_health", action: "resource_search", params: { keyword: "anxiety" } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.length > 0, detail: `${body.data?.length} results` })
  );

  // --- Financial: Alpha Vantage ---
  section("Alpha Vantage (Financial)");

  await test(
    "stock_quote: AAPL",
    () => apiPost({ provider_id: "alpha_vantage", action: "stock_quote", params: { symbol: "AAPL" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data, detail: JSON.stringify(body.data?.["Global Quote"]?.["05. price"] || body.data).slice(0, 60) }),
    available("alpha_vantage")
  );

  await test(
    "stock_search: Tesla",
    () => apiPost({ provider_id: "alpha_vantage", action: "stock_search", params: { keywords: "Tesla" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data }),
    available("alpha_vantage")
  );

  await test(
    "forex_rate: USD to EUR",
    () => apiPost({ provider_id: "alpha_vantage", action: "forex_rate", params: { from: "USD", to: "EUR" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data }),
    available("alpha_vantage")
  );

  // --- Social Impact: Every.org ---
  section("Every.org (Social Impact)");

  await test(
    "search_nonprofits: education",
    () => apiPost({ provider_id: "charity", action: "search_nonprofits", params: { query: "education", take: 5 } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }),
    available("charity")
  );

  await test(
    "search_nonprofits: climate",
    () => apiPost({ provider_id: "charity", action: "search_nonprofits", params: { query: "climate change", take: 3 } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }),
    available("charity")
  );

  // --- Environment: OpenWeatherMap ---
  section("OpenWeatherMap (Environment)");

  await test(
    "current_weather: Nashville",
    () => apiPost({ provider_id: "environment", action: "current_weather", params: { city: "Nashville", units: "imperial" } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.temperature != null, detail: `${body.data?.temperature}°F, ${body.data?.description}` }),
    available("environment")
  );

  await test(
    "air_quality: Nashville (36.17, -86.78)",
    () => apiPost({ provider_id: "environment", action: "air_quality", params: { lat: 36.17, lon: -86.78 } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.aqi != null, detail: `AQI ${body.data?.aqi} — ${body.data?.aqi_label}` }),
    available("environment")
  );

  await test(
    "Invalid city returns error",
    () => apiPost({ provider_id: "environment", action: "current_weather", params: { city: "XYZNOTACITY12345" } }),
    ({ status }) => ({ ok: status === 502 }),
    available("environment")
  );

  // --- AI: Anthropic Claude ---
  section("Anthropic Claude (AI)");

  await test(
    "chat: simple question",
    () => apiPost({ provider_id: "claude", action: "chat", params: { message: "Reply with exactly: hello from claude", max_tokens: 20 } }),
    ({ status, body }) => ({ ok: status === 200 && typeof body.data?.response === "string", detail: body.data?.response?.slice(0, 60) }),
    available("claude")
  );

  // --- AI: OpenAI ---
  section("OpenAI (AI)");

  await test(
    "chat: simple question",
    () => apiPost({ provider_id: "openai", action: "chat", params: { message: "Reply with exactly: hello from openai", max_tokens: 20 } }),
    ({ status, body }) => ({ ok: status === 200 && typeof body.data?.response === "string", detail: body.data?.response?.slice(0, 60) }),
    available("openai")
  );

  await test(
    "embed: short text",
    () => apiPost({ provider_id: "openai", action: "embed", params: { text: "procurement labs test" } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data?.embedding), detail: `${body.data?.embedding?.length}-dim vector` }),
    available("openai")
  );

  // --- AI: Google Gemini ---
  section("Google Gemini (AI)");

  await test(
    "chat: simple question",
    () => apiPost({ provider_id: "gemini", action: "chat", params: { message: "Reply with exactly: hello from gemini" } }),
    ({ status, body }) => ({ ok: status === 200 && typeof body.data?.response === "string", detail: body.data?.response?.slice(0, 60) }),
    available("gemini")
  );

  // --- AI: HuggingFace ---
  section("HuggingFace (AI)");

  await test(
    "text_classification: positive sentiment",
    () => apiPost({ provider_id: "huggingface", action: "text_classification", params: { text: "I love this product, it is amazing!" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data, detail: JSON.stringify(body.data).slice(0, 80) }),
    available("huggingface")
  );

  // --- Cloud: Google Cloud Translation ---
  section("Google Cloud Translation (Cloud)");

  await test(
    "translate: English to Spanish",
    () => apiPost({ provider_id: "google_cloud", action: "translate", params: { text: "Hello, how are you?", target: "es" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.translated_text, detail: body.data?.translated_text }),
    available("google_cloud")
  );

  await test(
    "detect_language: French text",
    () => apiPost({ provider_id: "google_cloud", action: "detect_language", params: { text: "Bonjour, comment allez-vous?" } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.language === "fr", detail: `Detected: ${body.data?.language}` }),
    available("google_cloud")
  );

  // --- Cloud: AWS Comprehend ---
  section("AWS Comprehend (Cloud)");

  await test(
    "detect_sentiment: positive text",
    () => apiPost({ provider_id: "aws", action: "detect_sentiment", params: { text: "I absolutely love this new product, it works perfectly!" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.Sentiment, detail: `Sentiment: ${body.data?.Sentiment}` }),
    available("aws")
  );

  await test(
    "detect_entities: news text",
    () => apiPost({ provider_id: "aws", action: "detect_entities", params: { text: "Amazon was founded by Jeff Bezos in Seattle, Washington." } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data?.Entities), detail: `${body.data?.Entities?.length} entities` }),
    available("aws")
  );

  // --- Maps: OpenStreetMap ---
  section("OpenStreetMap / Nominatim (Maps)");

  await test(
    "geocode: Vanderbilt University",
    () => apiPost({ provider_id: "openstreetmap", action: "geocode", params: { query: "Vanderbilt University Nashville", limit: 1 } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.length > 0, detail: body.data?.[0]?.display_name?.slice(0, 60) })
  );

  await test(
    "reverse_geocode: Nashville coords",
    () => apiPost({ provider_id: "openstreetmap", action: "reverse_geocode", params: { lat: 36.1627, lon: -86.7816 } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.display_name, detail: body.data?.display_name?.slice(0, 60) })
  );

  // --- Maps: Google Maps ---
  section("Google Maps (Maps)");

  await test(
    "geocode: 1600 Amphitheatre Parkway",
    () => apiPost({ provider_id: "google_maps", action: "geocode", params: { address: "1600 Amphitheatre Parkway, Mountain View, CA" } }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.lat != null, detail: `${body.data?.lat}, ${body.data?.lng}` }),
    available("google_maps")
  );

  await test(
    "places_search: coffee in Nashville",
    () => apiPost({ provider_id: "google_maps", action: "places_search", params: { query: "coffee shops in Nashville TN" } }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }),
    available("google_maps")
  );

  await test(
    "directions: Nashville to Memphis",
    () => apiPost({ provider_id: "google_maps", action: "directions", params: { origin: "Nashville, TN", destination: "Memphis, TN", mode: "driving" } }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.duration, detail: `${body.data?.distance}, ${body.data?.duration}` }),
    available("google_maps")
  );

  // --- Summary ---
  const total = passed + failed + skipped;
  console.log(`\n${"─".repeat(40)}`);
  console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET} · ${RED}${failed} failed${RESET} · ${YELLOW}${skipped} skipped${RESET} · ${total} total`);

  if (skipped > 0) {
    console.log(`${DIM}Skipped tests require API keys not currently set in Vercel env vars.${RESET}`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal error:${RESET}`, err.message);
  process.exit(1);
});
