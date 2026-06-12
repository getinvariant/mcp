// ClickHouse ledger: the transaction + creditworthiness-score source of truth.
//
// Every paid provider call writes one row to api_calls. The creditworthiness
// score is a ROLLING QUERY over that table (value delivered per dollar) — it
// lives in ClickHouse, not in app memory.
//
// The whole module is throw-safe when CLICKHOUSE_URL is unset: recordCall
// no-ops, the read fns return [], so the rest of the app runs without CH.

import { createClient, type ClickHouseClient } from "@clickhouse/client";

let _client: ClickHouseClient | null = null;

/** True only when a ClickHouse endpoint is configured. */
export function ledgerEnabled(): boolean {
  return !!process.env.CLICKHOUSE_URL;
}

function client(): ClickHouseClient {
  if (_client) return _client;
  _client = createClient({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });
  return _client;
}

/** One row of the ledger — mirrors the api_calls columns. */
export interface CallRecord {
  ts?: string; // let ClickHouse default to now64(3) when omitted
  request_id?: string;
  account_id: string;
  category: string;
  provider: string;
  action: string;
  cost_usd: number; // REAL $ Invariant paid the vendor for this one call
  success: 0 | 1 | boolean;
  accuracy?: number; // 0..1, judged later
  latency_ms: number;
  x402_tx?: string; // agent->us settlement tx hash
}

export interface ProviderScore {
  provider: string;
  calls: number;
  success_rate: number;
  avg_accuracy: number;
  total_cost_usd: number;
  avg_cost_usd: number;
  score: number;
}

/** The rolling creditworthiness query, exposed for the disabled-branch validator. */
export const SCORE_SQL = `
  SELECT
    provider,
    count()                                            AS calls,
    sum(success) / count()                             AS success_rate,
    avg(accuracy)                                      AS avg_accuracy,
    sum(cost_usd)                                      AS total_cost_usd,
    sum(cost_usd) / count()                            AS avg_cost_usd,
    (avg(accuracy) * (sum(success) / count()))
      / greatest(sum(cost_usd) / count(), 0.000001)    AS score
  FROM api_calls
  WHERE category = {category:String}
  GROUP BY provider
  ORDER BY score DESC
`;

export async function initLedger(): Promise<void> {
  if (!ledgerEnabled()) {
    console.log("[ledger] disabled, skipping initLedger");
    return;
  }
  await client().command({
    query: `
      CREATE TABLE IF NOT EXISTS api_calls (
        ts          DateTime64(3) DEFAULT now64(3),
        request_id  String,
        account_id  String,
        category    String,
        provider    String,
        action      String,
        cost_usd    Float64,
        success     UInt8,
        accuracy    Float64 DEFAULT 0,
        latency_ms  UInt32,
        x402_tx     String
      )
      ENGINE = MergeTree
      ORDER BY (category, provider, ts)
    `,
  });
}

export async function recordCall(rec: CallRecord): Promise<void> {
  if (!ledgerEnabled()) {
    console.log("[ledger] disabled, skipping recordCall");
    return;
  }
  try {
    const row: Record<string, unknown> = {
      request_id: rec.request_id ?? "",
      account_id: rec.account_id,
      category: rec.category,
      provider: rec.provider,
      action: rec.action,
      cost_usd: rec.cost_usd,
      success: typeof rec.success === "boolean" ? (rec.success ? 1 : 0) : rec.success,
      accuracy: rec.accuracy ?? 0,
      latency_ms: rec.latency_ms,
      x402_tx: rec.x402_tx ?? "",
    };
    if (rec.ts) row.ts = rec.ts;
    await client().insert({
      table: "api_calls",
      values: [row],
      format: "JSONEachRow",
    });
  } catch (e) {
    // Logging must never break the request path.
    console.error("[ledger] recordCall failed:", e);
  }
}

export async function scoreProviders(category: string): Promise<ProviderScore[]> {
  if (!ledgerEnabled()) return [];
  const rs = await client().query({
    query: SCORE_SQL,
    query_params: { category },
    format: "JSONEachRow",
  });
  const rows = await rs.json<Record<string, unknown>>();
  return rows.map((r) => ({
    provider: String(r.provider),
    calls: Number(r.calls),
    success_rate: Number(r.success_rate),
    avg_accuracy: Number(r.avg_accuracy),
    total_cost_usd: Number(r.total_cost_usd),
    avg_cost_usd: Number(r.avg_cost_usd),
    score: Number(r.score),
  }));
}

export async function rawRows(
  category: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  if (!ledgerEnabled()) return [];
  const rs = await client().query({
    query: `SELECT * FROM api_calls WHERE category = {category:String} ORDER BY ts DESC LIMIT {limit:UInt32}`,
    query_params: { category, limit },
    format: "JSONEachRow",
  });
  return rs.json<Record<string, unknown>>();
}
