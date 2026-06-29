// Axis B — per-customer, per-provider fairness.
//
// quota.ts already caps a customer's TOTAL rate. This adds a per-(account,
// provider) budget so one customer can't monopolize a single provider's shared
// key-pool capacity (or drive the aggregate volume that gets an upstream account
// flagged). Enforced BEFORE key selection: a customer over their slice 429s
// without ever touching the pool.
//
// Invariant to keep in mind when tuning limits:
//   Σ(customer per-provider budgets in flight) ≤ Σ(pool key budgets)
// so demand sheds fairly at the customer tier instead of banning an account.

import { consume } from "./token-bucket.js";

export interface CustomerBudgetResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

const DEFAULT_PER_PROVIDER_RPM = Number(process.env.CUSTOMER_PROVIDER_RPM || 120);

/**
 * Reserve one unit of a customer's per-provider budget. `perMinute` lets callers
 * pass a tier-derived limit; defaults to CUSTOMER_PROVIDER_RPM.
 */
export async function checkCustomerProviderBudget(
  accountId: string,
  provider: string,
  perMinute: number = DEFAULT_PER_PROVIDER_RPM,
): Promise<CustomerBudgetResult> {
  const res = await consume({
    key: `cb:${accountId}:${provider}`,
    capacity: perMinute,
    ratePerMinute: perMinute,
  });
  return { ok: res.ok, remaining: res.remaining, retryAfterMs: res.retryAfterMs };
}
