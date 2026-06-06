import { authenticateRequest } from "../lib/auth.js";
import { logUsage } from "../lib/db.js";
import { checkQuota } from "../lib/quota.js";
import { getProvider } from "../lib/providers/registry.js";
import { accrueCharge, refundAccrual } from "../lib/billing.js";
import { providerCostFor, trueUpCost } from "../lib/pricing.js";

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

  const { provider_id, action, params } = req.body;

  if (!provider_id || !action) {
    return res.status(400).json({ error: "Missing provider_id or action" });
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

  // Billing gate: accrue the worst-case cost BEFORE the upstream call so an
  // agent that hangs up mid-response still owes for what it triggered. Free
  // providers return 0 and short-circuit. Hard 402 on cap/card issues —
  // never serve a request we can't bill for.
  const callParams = params || {};
  const estimatedCents = providerCostFor(provider_id, action, callParams);
  if (estimatedCents > 0) {
    const accrued = await accrueCharge(auth.account!.id, provider_id, estimatedCents);
    if (!accrued.ok) {
      return res.status(402).json({
        error: `Payment required: ${accrued.reason}`,
        reason: accrued.reason,
      });
    }
  }

  const result = await provider.query(action, params || {});

  // True up estimated → actual for usage-based providers (LLMs). For flat-
  // priced providers trueUpCost returns 0 and refundAccrual is a no-op.
  // Only refund on success — a failed call still cost us the upstream attempt.
  if (estimatedCents > 0 && result.success) {
    const refundCents = trueUpCost(provider_id, action, callParams, result.data);
    if (refundCents > 0) {
      refundAccrual(auth.account!.id, provider_id, refundCents).catch((e) =>
        console.error("[billing] refund failed", e),
      );
    }
  }

  // log async — don't block the response
  logUsage(auth.account!.id, provider_id, action, result.success).catch(
    () => {},
  );

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
