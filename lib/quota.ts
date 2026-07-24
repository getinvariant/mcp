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
import { consume } from "./ratelimit/token-bucket.js";

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
// One bucket per account_id, refilling at `per_minute_rate`/min, burstable to
// the same. State lives in Upstash Redis (lib/ratelimit/token-bucket) so the
// limit holds across Vercel instances instead of being per-lambda. Degrades to
// an in-memory bucket automatically when Upstash isn't configured.

async function consumeToken(accountId: string, perMinuteRate: number): Promise<{
  ok: boolean;
  retryAfterMs?: number;
}> {
  const res = await consume({
    key: `q:${accountId}`,
    capacity: perMinuteRate,
    ratePerMinute: perMinuteRate,
  });
  return { ok: res.ok, retryAfterMs: res.retryAfterMs };
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
  const ratePass = await consumeToken(account.id, account.per_minute_rate);
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
