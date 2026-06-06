// Per-provider cost lookup. Returns cents the user owes for one call.
//
// We accrue BEFORE the upstream call (see api/query.ts), so for usage-based
// providers (LLMs) we charge a worst-case estimate and refund the unused
// portion in refundOvercharge() after we know real token counts.
//
// Free providers return 0 → accrueCharge short-circuits and never touches
// the billing ledger. Most of the catalog is free; only LLMs + a handful
// of paid APIs need real numbers here.

import type { Account } from "./db.js";

/**
 * Cost in cents to invoke (provider, action, params).
 * Estimates are deliberately conservative — overcharge is refunded post-call,
 * undercharge means we eat the difference.
 */
export function providerCostFor(
  providerId: string,
  action: string,
  params: Record<string, unknown>,
): number {
  const entry = PRICING[providerId];
  if (!entry) return 0;
  if (typeof entry === "number") return entry;
  return entry(action, params);
}

/**
 * Post-call true-up. Called after we know real token / response sizes.
 * Returns cents to credit back; lib/billing.ts applies as a negative
 * pending_charge so the next sweep nets it out.
 *
 * Most providers return 0 here — flat-priced calls don't true up.
 */
export function trueUpCost(
  providerId: string,
  action: string,
  params: Record<string, unknown>,
  result: unknown,
): number {
  const refunder = REFUNDERS[providerId];
  if (!refunder) return 0;
  const estimated = providerCostFor(providerId, action, params);
  const actual = refunder(action, params, result);
  return Math.max(0, estimated - actual);
}

// ---------- pricing table ----------
// Number = flat cents per call.
// Function = compute from action + params (use for token-based LLMs).
// Fill in real numbers as providers go paid.

type PriceFn = (action: string, params: Record<string, unknown>) => number;
type Refunder = (action: string, params: Record<string, unknown>, result: unknown) => number;

const PRICING: Record<string, number | PriceFn> = {
  // LLMs: estimate worst-case at max_tokens, refund the rest.
  // Numbers are per-1M tokens × markup. Replace with your real rates.
  anthropic: (action, params) => {
    const maxTokens = numFrom(params, "max_tokens", 1024);
    // Sonnet pricing ~ $3 in / $15 out per 1M. Estimate output only,
    // round up. 15 * (max/1M) cents → e.g. 1024 max = 1.5c, charged 2c.
    return Math.ceil((maxTokens / 1_000_000) * 1500);
  },
  openai: (action, params) => {
    const maxTokens = numFrom(params, "max_tokens", 1024);
    return Math.ceil((maxTokens / 1_000_000) * 1500);
  },
  gemini: (action, params) => {
    const maxTokens = numFrom(params, "max_tokens", 1024);
    return Math.ceil((maxTokens / 1_000_000) * 1000);
  },

  // Paid flat-per-call. Fill in your wholesale cost + markup.
  // mapbox: 1,
  // geoapify: 1,
  // finnhub: 2,
};

const REFUNDERS: Record<string, Refunder> = {
  anthropic: (_action, _params, result: any) => {
    const out = result?.usage?.output_tokens ?? 0;
    return Math.ceil((out / 1_000_000) * 1500);
  },
  openai: (_action, _params, result: any) => {
    const out = result?.usage?.completion_tokens ?? 0;
    return Math.ceil((out / 1_000_000) * 1500);
  },
  gemini: (_action, _params, result: any) => {
    const out = result?.usageMetadata?.candidatesTokenCount ?? 0;
    return Math.ceil((out / 1_000_000) * 1000);
  },
};

function numFrom(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
