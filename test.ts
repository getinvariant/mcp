#!/usr/bin/env tsx
/**
 * Procurement Labs — Comprehensive API Test Suite
 *
 * Usage:
 *   Local:  PL_API_KEY=pl_demo_key_2026 PL_BACKEND_URL=http://localhost:3000 npx tsx test.ts
 *   Prod:   PL_API_KEY=pl_demo_key_2026 PL_BACKEND_URL=https://procurementlabs.up.railway.app npx tsx test.ts
 */

const BASE_URL = process.env.PL_BACKEND_URL || "http://localhost:3000";
const PL_KEY = process.env.PL_API_KEY || "pl_demo_key_2026";

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const RESET  = "\x1b[0m";

let passed = 0, failed = 0, skipped = 0;

async function get(path: string, key = PL_KEY) {
  const res = await fetch(`${BASE_URL}/api/${path}`, { headers: { "x-pl-key": key } });
  return { status: res.status, body: await res.json() };
}

async function post(body: object, key = PL_KEY) {
  const res = await fetch(`${BASE_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pl-key": key },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function q(provider_id: string, action: string, params: object = {}) {
  return post({ provider_id, action, params });
}

type Check = (r: { status: number; body: any }) => { ok: boolean; detail?: string };

async function test(name: string, fn: () => Promise<{ status: number; body: any }>, check: Check, skipReason?: string) {
  if (skipReason) {
    skipped++;
    console.log(`  ${YELLOW}−${RESET} ${name} ${DIM}(skipped: ${skipReason})${RESET}`);
    return;
  }
  try {
    const res = await fn();
    const { ok, detail } = check(res);
    if (ok) {
      passed++;
      console.log(`  ${GREEN}✓${RESET} ${name}${detail ? ` ${DIM}— ${detail}${RESET}` : ""}`);
    } else {
      failed++;
      console.log(`  ${RED}✗${RESET} ${name} ${DIM}— ${detail || JSON.stringify(res.body).slice(0, 120)}${RESET}`);
    }
  } catch (err) {
    failed++;
    console.log(`  ${RED}✗${RESET} ${name} ${DIM}— ${(err as Error).message}${RESET}`);
  }
}

function section(name: string) {
  console.log(`\n${BOLD}${CYAN}${name}${RESET}`);
}

let available: string[] = [];

async function detectAvailable() {
  try {
    const { body } = await get("providers");
    available = (body.providers || []).filter((p: any) => p.available).map((p: any) => p.id);
  } catch {}
}

function needs(id: string): string | undefined {
  return available.includes(id) ? undefined : `${id} not configured`;
}

// ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}Procurement Labs — API Test Suite${RESET}`);
  console.log(`${DIM}Backend : ${BASE_URL}${RESET}`);
  console.log(`${DIM}PL Key  : ${PL_KEY.slice(0, 16)}...${RESET}`);

  // ── Auth ──────────────────────────────────────────────────
  section("Auth");

  await test("Rejects missing key",
    () => get("providers", ""),
    ({ status }) => ({ ok: status === 401, detail: `HTTP ${status}` }));

  await test("Rejects invalid key",
    () => get("providers", "pl_fake_key_000"),
    ({ status }) => ({ ok: status === 401, detail: `HTTP ${status}` }));

  await test("Accepts valid key",
    () => get("providers"),
    ({ status }) => ({ ok: status === 200, detail: `HTTP ${status}` }));

  // ── Provider discovery ────────────────────────────────────
  section("Provider Discovery");

  await detectAvailable();
  console.log(`  ${DIM}Configured providers: ${available.join(", ") || "none"}${RESET}`);

  await test("Returns provider list",
    () => get("providers"),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.providers), detail: `${body.providers?.length} total` }));

  await test("Filter by category=financial",
    () => get("providers?category=financial"),
    ({ status, body }) => ({ ok: status === 200 && body.providers?.every((p: any) => p.category === "financial"), detail: `${body.providers?.length} financial` }));

  await test("Filter by category=ai",
    () => get("providers?category=ai"),
    ({ status, body }) => ({ ok: status === 200 && body.providers?.every((p: any) => p.category === "ai"), detail: `${body.providers?.length} ai` }));

  await test("Unknown provider → 404",
    () => q("does_not_exist", "test"),
    ({ status }) => ({ ok: status === 404 }));

  // ── OpenFDA ───────────────────────────────────────────────
  section("OpenFDA  ·  Physical Health  ·  free, no key");

  await test("drug_search: ibuprofen",
    () => q("openfda", "drug_search", { query: "ibuprofen", limit: 3 }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }));

  await test("adverse_events: aspirin",
    () => q("openfda", "adverse_events", { drug: "aspirin", limit: 3 }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }));

  await test("recalls: contamination",
    () => q("openfda", "recalls", { query: "contamination", limit: 3 }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }));

  await test("Missing param → 502",
    () => q("openfda", "drug_search", {}),
    ({ status }) => ({ ok: status === 502 }));

  // ── Mental Health ─────────────────────────────────────────
  section("Mental Health Resources  ·  free, no key");

  await test("crisis_resources: all",
    () => q("mental_health", "crisis_resources"),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} resources` }));

  await test("crisis_resources: type=hotline",
    () => q("mental_health", "crisis_resources", { type: "hotline" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.every((r: any) => r.type === "hotline"), detail: `${body.data?.length} hotlines` }));

  await test("resource_search: veterans",
    () => q("mental_health", "resource_search", { keyword: "veterans" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.length > 0, detail: `${body.data?.length} results` }));

  await test("resource_search: substance abuse",
    () => q("mental_health", "resource_search", { keyword: "substance" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.length > 0, detail: `${body.data?.length} results` }));

  // ── CoinGecko ─────────────────────────────────────────────
  section("CoinGecko  ·  Finance / Crypto  ·  free, no key");

  await test("coin_price: bitcoin + ethereum",
    () => q("coingecko", "coin_price", { coins: "bitcoin,ethereum", currency: "usd" }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.bitcoin, detail: `BTC $${body.data?.bitcoin?.usd}` }));

  await test("trending coins",
    () => q("coingecko", "trending"),
    ({ status, body }) => ({ ok: status === 200 && !!body.data, detail: `${(body.data as any)?.coins?.length} trending` }));

  await test("coin_search: solana",
    () => q("coingecko", "coin_search", { query: "solana" }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }));

  await test("market_overview: top 5",
    () => q("coingecko", "market_overview", { limit: 5 }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data) && body.data?.length === 5, detail: `${body.data?.[0]?.name} #1` }));

  // ── Finnhub ───────────────────────────────────────────────
  section("Finnhub  ·  Finance / Stocks  ·  free key, 60 req/min");

  await test("stock_quote: AAPL",
    () => q("finnhub", "stock_quote", { symbol: "AAPL" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.current_price != null, detail: `AAPL $${body.data?.current_price}` }),
    needs("finnhub"));

  await test("stock_quote: NVDA",
    () => q("finnhub", "stock_quote", { symbol: "NVDA" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.current_price != null, detail: `NVDA $${body.data?.current_price}` }),
    needs("finnhub"));

  await test("company_news: TSLA",
    () => q("finnhub", "company_news", { symbol: "TSLA" }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} articles` }),
    needs("finnhub"));

  await test("forex_rate: USD → EUR",
    () => q("finnhub", "forex_rate", { from: "USD", to: "EUR" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.rate != null, detail: `1 USD = ${body.data?.rate} EUR` }),
    needs("finnhub"));

  await test("market_news: crypto",
    () => q("finnhub", "market_news", { category: "crypto" }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} articles` }),
    needs("finnhub"));

  // ── Every.org ─────────────────────────────────────────────
  section("Every.org  ·  Social Impact  ·  free key");

  await test("search_nonprofits: education",
    () => q("charity", "search_nonprofits", { query: "education", take: 5 }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }),
    needs("charity"));

  await test("search_nonprofits: climate",
    () => q("charity", "search_nonprofits", { query: "climate change", take: 5 }),
    ({ status, body }) => ({ ok: status === 200 && Array.isArray(body.data), detail: `${body.data?.length} results` }),
    needs("charity"));

  // ── OpenWeatherMap ────────────────────────────────────────
  section("OpenWeatherMap  ·  Environment  ·  free key, 60 req/min");

  await test("current_weather: Nashville",
    () => q("environment", "current_weather", { city: "Nashville", units: "imperial" }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.temperature != null, detail: `${body.data?.temperature}°F, ${body.data?.description}` }),
    needs("environment"));

  await test("air_quality: Nashville (36.17, -86.78)",
    () => q("environment", "air_quality", { lat: 36.17, lon: -86.78 }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.aqi != null, detail: `AQI ${body.data?.aqi} — ${body.data?.aqi_label}` }),
    needs("environment"));

  await test("Invalid city → 502",
    () => q("environment", "current_weather", { city: "XYZNOTACITY99999" }),
    ({ status }) => ({ ok: status === 502 }),
    needs("environment"));

  // ── Anthropic Claude ──────────────────────────────────────
  section("Anthropic Claude  ·  AI  ·  paid");

  await test("chat: simple prompt",
    () => q("claude", "chat", { message: "Reply with exactly three words: procurement labs works", max_tokens: 20 }),
    ({ status, body }) => ({ ok: status === 200 && typeof body.data?.response === "string", detail: `"${body.data?.response?.trim().slice(0, 60)}"` }),
    needs("claude"));

  // ── Google Gemini ─────────────────────────────────────────
  section("Google Gemini  ·  AI  ·  free, 1,500 req/day");

  await test("chat: simple prompt",
    () => q("gemini", "chat", { message: "Reply with exactly three words: procurement labs works" }),
    ({ status, body }) => ({ ok: status === 200 && typeof body.data?.response === "string", detail: `"${body.data?.response?.trim().slice(0, 60)}"` }),
    needs("gemini"));

  // ── HuggingFace ───────────────────────────────────────────
  section("HuggingFace  ·  AI  ·  free key");

  await test("text_classification: positive",
    () => q("huggingface", "text_classification", { text: "I love this product, it is absolutely amazing!" }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data, detail: JSON.stringify(body.data).slice(0, 80) }),
    needs("huggingface"));

  await test("text_classification: negative",
    () => q("huggingface", "text_classification", { text: "This is terrible, I hate it completely." }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data, detail: JSON.stringify(body.data).slice(0, 80) }),
    needs("huggingface"));

  // ── Geoapify ──────────────────────────────────────────────
  section("Geoapify  ·  Maps  ·  free key, 3,000 req/day");

  await test("geocode: Vanderbilt University",
    () => q("geoapify", "geocode", { query: "Vanderbilt University Nashville TN", limit: 1 }),
    ({ status, body }) => ({ ok: status === 200 && body.data?.length > 0, detail: body.data?.[0]?.display_name?.slice(0, 60) }),
    needs("geoapify"));

  await test("reverse_geocode: Nashville (36.16, -86.78)",
    () => q("geoapify", "reverse_geocode", { lat: 36.1627, lon: -86.7816 }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.display_name, detail: body.data?.display_name?.slice(0, 60) }),
    needs("geoapify"));

  await test("route: Nashville → Memphis",
    () => q("geoapify", "route", { from_lat: 36.16, from_lon: -86.78, to_lat: 35.14, to_lon: -90.05, mode: "drive" }),
    ({ status, body }) => ({ ok: status === 200 && !!body.data?.duration_readable, detail: `${body.data?.distance_km}, ${body.data?.duration_readable}` }),
    needs("geoapify"));

  // ── Summary ───────────────────────────────────────────────
  const total = passed + failed + skipped;
  console.log(`\n${"─".repeat(48)}`);
  console.log(`${BOLD}Results:${RESET}  ${GREEN}${passed} passed${RESET}  ·  ${RED}${failed} failed${RESET}  ·  ${YELLOW}${skipped} skipped${RESET}  ·  ${total} total`);
  if (skipped > 0) console.log(`${DIM}Skipped = API key not set in backend env vars.${RESET}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal:${RESET}`, err.message);
  process.exit(1);
});
