import { randomUUID } from "node:crypto";
import { authenticateRequest } from "../lib/auth.js";
import { logUsage } from "../lib/db.js";
import { checkQuota } from "../lib/quota.js";
import { getProvider } from "../lib/providers/registry.js";
import { accrueCharge, refundAccrual } from "../lib/billing.js";
import { providerCostFor, trueUpCost } from "../lib/pricing.js";
import { ledgerEnabled, recordCall } from "../lib/ledger/clickhouse.js";
import { judgeAccuracy } from "../lib/inference/accuracy.js";
import { startTrace } from "../lib/trace/langfuse.js";
import { x402Enabled, buildRequirements, settlePayment } from "../lib/x402/server.js";

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

  const callParams = params || {};
  const category = String(provider.info.category);
  const estimatedCents = providerCostFor(provider_id, action, callParams);
  const isPaid = estimatedCents > 0;
  const requestId = randomUUID();

  // One Langfuse trace per bureau request. Spans: route-decision, x402-payment,
  // accuracy-judgment, (downgrade lives in the auto-downgrade orchestrator).
  const trace = startTrace("api.query", {
    accountId: auth.account!.id,
    input: { provider_id, action, params: callParams },
    metadata: { category, request_id: requestId, paid: isPaid },
  });
  trace.event(
    "route-decision",
    { provider_id, action },
    { chosen: provider_id, category, estimated_cost_usd: estimatedCents / 100 },
  );

  // Payment gate for PAID calls (the agent→us leg). Two rails:
  //  - x402 (when X402_ENABLED): real Base Sepolia USDC. 402 until a payment
  //    settles on-chain; the tx hash becomes the ledger's x402_tx.
  //  - card accrual (default): accrue worst-case cost so an agent that hangs up
  //    mid-response still owes for what it triggered.
  // Either way we never serve a paid request we can't bill for.
  let x402Tx = "";
  if (isPaid && x402Enabled()) {
    const paySpan = trace.span("x402-payment", {
      rail: "x402",
      price_usdc: process.env.X402_PRICE_USDC || "0.01",
    });
    const resource = `${publicBaseUrl(req)}/api/query#${provider_id}.${action}`;
    const requirements = buildRequirements(
      resource,
      `Invariant bureau call: ${provider_id}.${action}`,
    );
    const xPayment = req.headers["x-payment"] as string | undefined;
    if (!xPayment) {
      paySpan.end({ ok: false, reason: "no X-PAYMENT header" });
      trace.update({ status: 402 });
      void trace.flush();
      // x402 protocol envelope: client reads `accepts` to construct payment.
      return res.status(402).json({
        x402Version: 1,
        error: "X-PAYMENT header required",
        accepts: [requirements],
      });
    }
    const settled = await settlePayment(xPayment, requirements);
    if (!settled.ok) {
      paySpan.end({ ok: false, reason: settled.reason });
      trace.update({ status: 402 });
      void trace.flush();
      return res.status(402).json({
        x402Version: 1,
        error: `payment failed: ${settled.reason}`,
        accepts: [requirements],
      });
    }
    x402Tx = settled.txHash || "";
    // Surface the settlement to the client (the agent→us leg, on-chain proof).
    res.setHeader("X-PAYMENT-RESPONSE", Buffer.from(JSON.stringify(settled)).toString("base64"));
    paySpan.end({ ok: true, leg: "x402", tx: x402Tx, payer: settled.payer });
  } else if (isPaid) {
    const paySpan = trace.span("x402-payment", { rail: "card-accrual" });
    const accrued = await accrueCharge(auth.account!.id, provider_id, estimatedCents);
    if (!accrued.ok) {
      paySpan.end({ ok: false, reason: accrued.reason });
      trace.update({ status: 402 });
      void trace.flush();
      return res.status(402).json({
        error: `Payment required: ${accrued.reason}`,
        reason: accrued.reason,
      });
    }
    paySpan.end({ ok: true, leg: "card-accrual" });
  }

  const startedAt = Date.now();
  const result = await provider.query(action, callParams);
  const latencyMs = Date.now() - startedAt;

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

  // log async — don't block the response
  logUsage(auth.account!.id, provider_id, action, result.success).catch(
    () => {},
  );

  // Credit-bureau ledger: every PAID call writes one row to ClickHouse with the
  // real cost, success, and a Pioneer-judged accuracy. This is the source of
  // truth the creditworthiness score rolls up over. Free providers don't enter
  // the bureau. We await it so the row exists before the agent gets its answer.
  if (isPaid && ledgerEnabled()) {
    let accuracy = 0;
    if (result.success) {
      const accSpan = trace.span("accuracy-judgment", {
        provider: provider_id,
        action,
      });
      const verdict = await judgeAccuracy({
        category,
        provider: provider_id,
        action,
        params: callParams,
        result: result.data,
      });
      accuracy = verdict.accuracy;
      accSpan.end(verdict);
    }
    await recordCall({
      request_id: requestId,
      account_id: auth.account!.id,
      category,
      provider: provider_id,
      action,
      cost_usd: estimatedCents / 100, // REAL $ Invariant pays the vendor
      success: result.success,
      accuracy,
      latency_ms: latencyMs,
      x402_tx: x402Tx, // agent→us on-chain settlement (empty on the card rail)
    });
  }

  trace.update({ status: result.success ? 200 : 502, latency_ms: latencyMs });
  void trace.flush();

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
