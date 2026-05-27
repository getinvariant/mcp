// Quota + rate enforcement.
//
// Two layers stack here:
//   1. Per-minute rate limit (in-memory token bucket per account_id).
//   2. Monthly quota check against DB (count of successful calls this month).
//
// We check BEFORE dispatching the provider call so a user over quota gets a
// 429 with a useful body instead of burning their own quota on a rejected
// upstream request. Increment happens in logUsage() inside the existing
// success path — we don't double-count.

import type { Account } from "./db.js";
import { getMonthlyUsageTotal } from "./db.js";

export interface QuotaResult {
  ok: boolean;
  /** Calls remaining this month after a successful pass. */
  remaining: number;
  error?: string;
  /** Status code the caller should serve when ok=false. */
  status?: number;
  /** When the rate-limit window resets, in ms-since-epoch. Only set on 429. */
  retryAfterMs?: number;
}

// ─── Per-minute token bucket ─────────────────────────────────────────────
//
// One bucket per account_id. Refills at `per_minute_rate` tokens per minute,
// burstable up to that same number. Lives in memory — fine for a single
// serverless instance; on Vercel each lambda gets its own bucket which means
// effective rate is per-instance × instances. For demo + early users that's
// generous-but-not-broken; switch to Upstash Redis when scale matters.

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  capacity: number;
  refillPerMs: number;
}

const buckets = new Map<string, Bucket>();

function consumeToken(accountId: string, perMinuteRate: number): {
  ok: boolean;
  retryAfterMs?: number;
} {
  const now = Date.now();
  let bucket = buckets.get(accountId);
  if (!bucket || bucket.capacity !== perMinuteRate) {
    bucket = {
      tokens: perMinuteRate,
      lastRefillMs: now,
      capacity: perMinuteRate,
      refillPerMs: perMinuteRate / 60_000,
    };
    buckets.set(accountId, bucket);
  } else {
    // Drip-refill since the last call.
    const elapsed = now - bucket.lastRefillMs;
    bucket.tokens = Math.min(
      bucket.capacity,
      bucket.tokens + elapsed * bucket.refillPerMs,
    );
    bucket.lastRefillMs = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }

  const deficit = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(deficit / bucket.refillPerMs);
  return { ok: false, retryAfterMs };
}

// ─── Combined check ──────────────────────────────────────────────────────

/**
 * Verify the account has both rate-limit headroom AND monthly quota left.
 * Call this BEFORE dispatching to the provider. The successful provider
 * call is counted by logUsage() (already wired in api/query.ts), so this
 * function only reads — it does not increment.
 */
export async function checkQuota(account: Account): Promise<QuotaResult> {
  // 1. Per-minute bucket
  const ratePass = consumeToken(account.id, account.per_minute_rate);
  if (!ratePass.ok) {
    return {
      ok: false,
      remaining: 0,
      error: `Rate limit exceeded (${account.per_minute_rate}/min). Retry in ${Math.ceil((ratePass.retryAfterMs ?? 1000) / 1000)}s.`,
      status: 429,
      retryAfterMs: ratePass.retryAfterMs,
    };
  }

  // 2. Monthly quota
  const used = await getMonthlyUsageTotal(account.id);
  const remaining = account.monthly_quota - used;
  if (remaining <= 0) {
    return {
      ok: false,
      remaining: 0,
      error: `Monthly quota exhausted (${used}/${account.monthly_quota} on tier '${account.tier}'). Upgrade at https://invariant.dev/billing.`,
      status: 402, // Payment Required — invites the upgrade flow
    };
  }

  return { ok: true, remaining };
}

/**
 * Kept for backwards-compat with the old stub signature. New code should
 * call checkQuota() directly.
 */
export async function checkAndIncrement(
  _plKey: string,
  account: Account,
): Promise<QuotaResult> {
  return checkQuota(account);
}
