// Shared bureau call: run a paid provider call, judge its accuracy on Pioneer,
// and record the real cost + outcome to the ClickHouse ledger. This is the same
// data path api/query.ts runs inline; factored out so the auto-downgrade
// orchestrator drives identical, real ledger writes.
//
// Fault injection (CLAUDE.md step 7): when a provider is marked degraded, the
// call still costs us money (we paid the vendor / fronted the request) but
// returns an outage/garbage — so success and accuracy crater while cost stays,
// which is exactly what should tank a creditworthiness score.

import { getProvider } from "../providers/registry.js";
import { providerCostFor } from "../pricing.js";
import { judgeAccuracy } from "../inference/accuracy.js";
import { recordCall } from "../ledger/clickhouse.js";
import { randomUUID } from "node:crypto";

export type Fault = "outage" | "latency" | "garbage" | null;

export interface BureauCallResult {
  provider: string;
  success: boolean;
  cost_usd: number;
  accuracy: number;
  latency_ms: number;
  fault: Fault;
  error?: string;
}

/** Degraded providers come from BUREAU_DEGRADE (comma-separated ids). */
export function degradedProviders(): Set<string> {
  return new Set(
    (process.env.BUREAU_DEGRADE || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function runBureauCall(opts: {
  providerId: string;
  action: string;
  params: Record<string, unknown>;
  category?: string;
  accountId?: string;
  /** Force a fault regardless of env (used by the downgrade orchestrator). */
  fault?: Fault;
}): Promise<BureauCallResult> {
  const { providerId, action, params } = opts;
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`unknown provider ${providerId}`);
  const category = opts.category || String(provider.info.category);
  const accountId = opts.accountId || "acct_bureau";
  const cents = providerCostFor(providerId, action, params);

  const fault: Fault =
    opts.fault ?? (degradedProviders().has(providerId) ? "outage" : null);

  const started = Date.now();
  let success: boolean;
  let data: unknown;
  let error: string | undefined;

  if (fault === "outage") {
    // We still fronted the request → we still pay. No usable result.
    success = false;
    error = "injected fault: provider outage (5xx)";
    data = undefined;
  } else if (fault === "garbage") {
    // 200 but the payload is useless — Pioneer will grade it ~0.
    success = true;
    data = { note: "service degraded — empty/placeholder response", results: [] };
  } else {
    const r = await provider.query(action, params);
    success = r.success;
    data = r.data;
    error = r.error;
    if (fault === "latency") await new Promise((res) => setTimeout(res, 1200));
  }

  const latency_ms = Date.now() - started + (fault === "latency" ? 1200 : 0);

  let accuracy = 0;
  if (success) {
    const v = await judgeAccuracy({ category, provider: providerId, action, params, result: data });
    accuracy = v.accuracy;
  }

  await recordCall({
    request_id: randomUUID(),
    account_id: accountId,
    category,
    provider: providerId,
    action,
    cost_usd: cents / 100, // REAL money spent even when the call underdelivers
    success,
    accuracy,
    latency_ms,
    x402_tx: "",
  });

  return { provider: providerId, success, cost_usd: cents / 100, accuracy, latency_ms, fault, error };
}
