import { authenticateRequest } from "../lib/auth.js";
import { logUsage } from "../lib/db.js";
import { checkQuota } from "../lib/quota.js";
import { getProvider } from "../lib/providers/registry.js";
import { accrueCharge, refundAccrual } from "../lib/billing.js";
import { providerCostFor, trueUpCost } from "../lib/pricing.js";
import { checkCustomerProviderBudget } from "../lib/ratelimit/customer.js";
import { selectProvider, recordOutcome } from "../lib/routing/router.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(
    req.headers["x-pl-key"] as string,
    req.headers["authorization"] as string | undefined,
  );
  if (!auth.ok) {
    if (auth.status === 401) {
      // MCP-spec: hint where to authorize via WWW-Authenticate.
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${publicBaseUrl(req)}/.well-known/oauth-protected-resource"`,
      );
    }
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  // Quota enforcement before dispatching the provider call so an over-quota
  // user doesn't burn an upstream key on a request that would be rejected.
  const quota = await checkQuota(auth.account!);
  if (!quota.ok) {
    if (quota.retryAfterMs) {
      res.setHeader("Retry-After", String(Math.ceil(quota.retryAfterMs / 1000)));
    }
    return res.status(quota.status || 429).json({ error: quota.error });
  }

  let { provider_id } = req.body;
  const { action, params, task_type } = req.body;

  // G4 — single allocator. When the caller names a task_type instead of a
  // provider, the router picks the highest-success-rate provider for it from
  // real call history. recordOutcome (below) closes the loop so the choice
  // improves over time.
  if (!provider_id && task_type) {
    try {
      const sel = await selectProvider(auth.account!.id, String(task_type));
      provider_id = sel.chosen;
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  }

  if (!provider_id || !action) {
    return res.status(400).json({ error: "Missing provider_id (or task_type) and action" });
  }

  const provider = getProvider(provider_id);
  if (!provider) {
    return res
      .status(404)
      .json({ error: `Provider '${provider_id}' not found` });
  }

  if (!provider.isAvailable()) {
    return res
      .status(503)
      .json({
        error: `Provider '${provider.info.name}' is not configured on the server`,
      });
  }

  // Axis B — per-customer, per-provider fairness. Enforced before any upstream
  // call so one customer can't drain a provider's shared key-pool capacity (or
  // drive the volume that gets our upstream account flagged). They hit their own
  // slice and 429 without touching the pool.
  const customerBudget = await checkCustomerProviderBudget(auth.account!.id, provider_id);
  if (!customerBudget.ok) {
    res.setHeader("Retry-After", String(Math.ceil(customerBudget.retryAfterMs / 1000)));
    return res.status(429).json({
      error: `Per-provider rate limit for '${provider_id}' reached. Retry in ${Math.ceil(customerBudget.retryAfterMs / 1000)}s.`,
    });
  }

  const callParams = params || {};
  const estimatedCents = providerCostFor(provider_id, action, callParams);
  const isPaid = estimatedCents > 0;

  // Billing gate for PAID calls: accrue the worst-case cost on the customer's
  // card-on-file balance BEFORE the upstream call, so an agent that hangs up
  // mid-response still owes for what it triggered. We never serve a paid request
  // we can't bill for. (Trued up to actual below for usage-priced providers.)
  if (isPaid) {
    const accrued = await accrueCharge(auth.account!.id, provider_id, estimatedCents);
    if (!accrued.ok) {
      return res.status(402).json({
        error: `Payment required: ${accrued.reason}`,
        reason: accrued.reason,
      });
    }
  }

  const startedAt = Date.now();
  const result = await provider.query(action, callParams);
  const latencyMs = Date.now() - startedAt;

  // Close the allocator loop: feed the outcome back so the router's success-rate
  // ranking reflects reality on the next call for this task_type.
  if (task_type) {
    recordOutcome({
      accountId: auth.account!.id,
      taskType: String(task_type),
      provider: provider_id,
      success: result.success,
      latencyMs,
    }).catch(() => {});
  }

  // True up estimated → actual for usage-based providers (LLMs). For flat-
  // priced providers trueUpCost returns 0 and refundAccrual is a no-op.
  // Only refund on success — a failed call still cost us the upstream attempt.
  if (isPaid && result.success) {
    const refundCents = trueUpCost(provider_id, action, callParams, result.data);
    if (refundCents > 0) {
      refundAccrual(auth.account!.id, provider_id, refundCents).catch((e) =>
        console.error("[billing] refund failed", e),
      );
    }
  }

  // Record usage + the real per-call cost (cents we pay the vendor) so
  // per-customer and per-provider spend is queryable from usage_log. Async —
  // don't block the response.
  logUsage(
    auth.account!.id,
    provider_id,
    action,
    result.success,
    isPaid && result.success ? estimatedCents : 0,
  ).catch(() => {});

  if (!result.success) {
    return res.status(502).json({ error: result.error });
  }

  return res.status(200).json({
    data: result.data,
    quota: { remaining: quota.remaining - 1 },
  });
}

function publicBaseUrl(req: any): string {
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}
