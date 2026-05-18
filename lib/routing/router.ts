import { supabase } from "../db.js";

export const PROVIDERS_BY_TASK: Record<string, string[]> = {
  "finance:price": ["coingecko", "finnhub"],
};

type StatsRow = {
  total_calls: number;
  success_count: number;
  sum_latency_ms: number;
};

const cache: Map<string, Map<string, Map<string, StatsRow>>> = new Map();
const callIndex: Map<string, Map<string, number>> = new Map();
const loaded = new Set<string>();

function getTaskCache(accountId: string, taskType: string) {
  let acc = cache.get(accountId);
  if (!acc) {
    acc = new Map();
    cache.set(accountId, acc);
  }
  let tc = acc.get(taskType);
  if (!tc) {
    tc = new Map();
    acc.set(taskType, tc);
  }
  return tc;
}

function rate(s: StatsRow | undefined): number {
  if (!s || s.total_calls === 0) return 0.5;
  return s.success_count / s.total_calls;
}

async function ensureLoaded(accountId: string, taskType: string) {
  const k = `${accountId}::${taskType}`;
  if (loaded.has(k)) return;

  const tc = getTaskCache(accountId, taskType);
  const { data } = await supabase
    .from("routing_stats")
    .select("*")
    .eq("account_id", accountId)
    .eq("task_type", taskType);
  for (const r of data ?? []) {
    tc.set(r.provider, {
      total_calls: r.total_calls,
      success_count: r.success_count,
      sum_latency_ms: Number(r.sum_latency_ms ?? 0),
    });
  }

  const { data: maxCall } = await supabase
    .from("routing_events")
    .select("call_index")
    .eq("account_id", accountId)
    .eq("task_type", taskType)
    .order("call_index", { ascending: false })
    .limit(1);
  let accCi = callIndex.get(accountId);
  if (!accCi) {
    accCi = new Map();
    callIndex.set(accountId, accCi);
  }
  accCi.set(taskType, maxCall?.[0]?.call_index ?? 0);

  loaded.add(k);
}

export async function selectProvider(accountId: string, taskType: string) {
  await ensureLoaded(accountId, taskType);
  const candidates = PROVIDERS_BY_TASK[taskType];
  if (!candidates) throw new Error(`unknown task_type: ${taskType}`);

  const tc = getTaskCache(accountId, taskType);
  const rates: Record<string, number> = {};
  let chosen = candidates[0];
  let best = -1;
  for (const p of candidates) {
    rates[p] = rate(tc.get(p));
    if (rates[p] > best) {
      best = rates[p];
      chosen = p;
    }
  }
  console.log(
    `[router] acct=${accountId.slice(0, 8)} task=${taskType} chose=${chosen} rates=${JSON.stringify(rates)}`,
  );
  return { chosen, rates };
}

export async function recordOutcome(args: {
  accountId: string;
  taskType: string;
  provider: string;
  success: boolean;
  latencyMs: number;
}) {
  const { accountId, taskType, provider, success, latencyMs } = args;
  await ensureLoaded(accountId, taskType);

  const tc = getTaskCache(accountId, taskType);
  const cur = tc.get(provider) ?? {
    total_calls: 0,
    success_count: 0,
    sum_latency_ms: 0,
  };
  cur.total_calls += 1;
  if (success) cur.success_count += 1;
  cur.sum_latency_ms += latencyMs;
  tc.set(provider, cur);

  const candidates = PROVIDERS_BY_TASK[taskType] ?? [];
  const rates_after: Record<string, number> = {};
  for (const p of candidates) rates_after[p] = rate(tc.get(p));

  let accCi = callIndex.get(accountId);
  if (!accCi) {
    accCi = new Map();
    callIndex.set(accountId, accCi);
  }
  const ci = (accCi.get(taskType) ?? 0) + 1;
  accCi.set(taskType, ci);

  await supabase.from("routing_stats").upsert(
    {
      account_id: accountId,
      task_type: taskType,
      provider,
      total_calls: cur.total_calls,
      success_count: cur.success_count,
      sum_latency_ms: cur.sum_latency_ms,
      last_latency_ms: latencyMs,
      last_success: success,
      last_updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id,task_type,provider" },
  );

  await supabase.from("routing_events").insert({
    account_id: accountId,
    task_type: taskType,
    call_index: ci,
    provider,
    success,
    latency_ms: latencyMs,
    rates_after,
  });

  return { rates_after, call_index: ci };
}

export async function getStatus(accountId: string, taskType: string) {
  await ensureLoaded(accountId, taskType);
  const tc = getTaskCache(accountId, taskType);
  const candidates = PROVIDERS_BY_TASK[taskType] ?? [];

  const providers = candidates.map((p) => {
    const s = tc.get(p);
    const total = s?.total_calls ?? 0;
    const ok = s?.success_count ?? 0;
    const avg = total > 0 ? Math.round((s!.sum_latency_ms ?? 0) / total) : 0;
    return {
      name: p,
      success_rate: total ? ok / total : 0.5,
      ok,
      total,
      avg_latency_ms: avg,
    };
  });

  const { data: events } = await supabase
    .from("routing_events")
    .select("call_index, provider, success, rates_after")
    .eq("account_id", accountId)
    .eq("task_type", taskType)
    .order("call_index", { ascending: true })
    .limit(500);

  return {
    providers,
    events: (events ?? []) as {
      call_index: number;
      provider: string;
      success: boolean;
      rates_after: Record<string, number>;
    }[],
    calls_routed: events?.length ?? 0,
  };
}
