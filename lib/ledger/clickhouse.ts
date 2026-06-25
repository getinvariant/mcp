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
    // ClickHouse Cloud idles the service; the first call after a sleep can take
    // 10s+ to wake. A short default timeout silently drops the row (recordCall
    // is throw-safe), so give cold-starts room and keep the socket warm.
    request_timeout: 30_000,
    keep_alive: { enabled: true },
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
  base_score: number; // creditworthiness from our own calls only
  health: number; // 0..1 leading signal (Airbyte: status/pricing). 1 = clear.
  status: string; // latest external status, '' when none
  score: number; // base_score × health — what actually routes the money
}

// The rolling creditworthiness query. The score is our own value-per-dollar
// (accuracy × success ÷ cost) MULTIPLIED by a leading-signal health factor that
// Airbyte syncs into provider_context from each provider's status/pricing page.
// An active incident or price hike (health < 1) docks the score BEFORE any of
// our own calls fail. LEFT JOIN + coalesce → providers with no context score
// exactly as before (health defaults to 1).
export const SCORE_SQL = `
  WITH ctx AS (
    SELECT provider, argMax(health, ts) AS health, argMax(status, ts) AS status
    FROM provider_context
    GROUP BY provider
  )
  SELECT
    a.provider                                           AS provider,
    count()                                              AS calls,
    sum(a.success) / count()                             AS success_rate,
    avg(a.accuracy)                                      AS avg_accuracy,
    sum(a.cost_usd)                                      AS total_cost_usd,
    sum(a.cost_usd) / count()                            AS avg_cost_usd,
    (avg(a.accuracy) * (sum(a.success) / count()))
      / greatest(sum(a.cost_usd) / count(), 0.000001)    AS base_score,
    coalesce(any(c.health), 1.0)                         AS health,
    coalesce(any(c.status), '')                          AS status,
    base_score * health                                  AS score
  FROM api_calls AS a
  LEFT JOIN ctx AS c ON a.provider = c.provider
  WHERE a.category = {category:String}
  GROUP BY a.provider
  ORDER BY score DESC
  -- join_use_nulls so a provider with no context row yields NULL health (→
  -- coalesce 1.0), not ClickHouse's Float64 default of 0 which would zero the
  -- score of every provider we have no status signal for.
  SETTINGS join_use_nulls = 1
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
  await ensureContextTable();
}

// provider_context holds Airbyte-synced LEADING signals: each provider's status
// page / pricing page state, distilled to a health factor in [0,1]. Created
// lazily so scoreProviders' LEFT JOIN never references a missing table.
let _ctxEnsured = false;
async function ensureContextTable(): Promise<void> {
  if (_ctxEnsured || !ledgerEnabled()) return;
  await client().command({
    query: `
      CREATE TABLE IF NOT EXISTS provider_context (
        ts        DateTime64(3) DEFAULT now64(3),
        provider  String,
        source    String,
        status    String,
        health    Float64,
        note      String
      )
      ENGINE = MergeTree
      ORDER BY (provider, ts)
    `,
  });
  _ctxEnsured = true;
}

export interface ContextSignal {
  provider: string;
  source: string; // 'statuspage' | 'pricing' | 'incident'
  status: string; // e.g. 'operational', 'major_outage', 'price_hike'
  health: number; // 0..1 — 1 clear, <1 docks the score as a leading signal
  note?: string;
}

/** Write one leading-signal row (Airbyte sync or the incident simulator). */
export async function recordContextSignal(sig: ContextSignal): Promise<void> {
  if (!ledgerEnabled()) {
    console.log("[ledger] disabled, skipping recordContextSignal");
    return;
  }
  await ensureContextTable();
  await client().insert({
    table: "provider_context",
    values: [
      {
        provider: sig.provider,
        source: sig.source,
        status: sig.status,
        health: sig.health,
        note: sig.note ?? "",
      },
    ],
    format: "JSONEachRow",
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
  await ensureContextTable();
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
    base_score: Number(r.base_score),
    health: Number(r.health),
    status: String(r.status ?? ""),
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
