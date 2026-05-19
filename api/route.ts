import { authenticateRequest } from "../lib/auth.js";
import { getProvider } from "../lib/providers/registry.js";
import {
  selectProvider,
  recordOutcome,
  PROVIDERS_BY_TASK,
} from "../lib/routing/router.js";
import { handleRouteFetch } from "./route-fetch.js";

const ACTION_BY_PROVIDER: Record<string, Record<string, string>> = {
  "finance:price": { coingecko: "coin_price", finnhub: "stock_quote" },
  "places:geocode": { geoapify: "geocode", mapbox: "geocode" },
};

// For task types not covered by the legacy finance:price normalize/result
// flow, we delegate to handleRouteFetch (the SDK path) via a stub source so
// the agent can call the MCP `route` tool for geocoding, weather, etc. and
// get a routed response back in the same RouteResponse shape.
const DELEGATE_SOURCE: Record<string, string> = {
  "places:geocode": "nominatim",
  "env:weather": "openweather",
  "finance:price:crypto": "coingecko",
  "finance:price:stock": "finnhub",
};

const COINGECKO_SLUG: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  MATIC: "matic-network",
  KAS: "kaspa",
  TIA: "celestia",
  JTO: "jito-governance-token",
  PYTH: "pyth-network",
  WIF: "dogwifcoin",
  BONK: "bonk",
};

type NormalizedParams =
  | { ok: true; params: Record<string, unknown>; symbol: string; currency: string }
  | { ok: false; error: string };

function normalizeParams(
  providerId: string,
  taskType: string,
  params: Record<string, any>,
): NormalizedParams {
  if (taskType !== "finance:price") {
    return { ok: false, error: `unsupported task_type: ${taskType}` };
  }
  const symbolRaw = params?.symbol;
  if (typeof symbolRaw !== "string" || symbolRaw.trim() === "") {
    return { ok: false, error: "params.symbol required (string)" };
  }
  const symbol = symbolRaw.trim().toUpperCase();
  const currency =
    (params.currency as string | undefined)?.toLowerCase() || "usd";

  if (providerId === "coingecko") {
    const slug = COINGECKO_SLUG[symbol];
    if (!slug) {
      return {
        ok: false,
        error: `coingecko: no slug mapping for ${symbol}`,
      };
    }
    return { ok: true, params: { coins: slug, currency }, symbol, currency };
  }

  if (providerId === "finnhub") {
    return { ok: true, params: { symbol }, symbol, currency };
  }

  return { ok: false, error: `unknown provider: ${providerId}` };
}

type NormalizedResult =
  | { success: true; result: { price: number; currency: string } }
  | { success: false; result: { error: string } };

function normalizeResult(
  providerId: string,
  symbol: string,
  currency: string,
  raw: { success: boolean; data?: any; error?: string },
): NormalizedResult {
  if (!raw.success) {
    return { success: false, result: { error: raw.error ?? "provider error" } };
  }

  if (providerId === "coingecko") {
    const slug = COINGECKO_SLUG[symbol];
    const bucket = slug ? raw.data?.[slug] : undefined;
    const price = bucket?.[currency];
    if (typeof price !== "number" || !(price > 0)) {
      return {
        success: false,
        result: { error: `coingecko returned no price for ${symbol}` },
      };
    }
    return { success: true, result: { price, currency } };
  }

  if (providerId === "finnhub") {
    const price = raw.data?.current_price;
    if (typeof price !== "number" || !(price > 0)) {
      return {
        success: false,
        result: { error: `finnhub returned no price for ${symbol}` },
      };
    }
    return { success: true, result: { price, currency } };
  }

  return { success: false, result: { error: `unknown provider: ${providerId}` } };
}

export interface RouteResponse {
  provider: string;
  rates: Record<string, number>;
  success: boolean;
  latency_ms: number;
  result: any;
  call_index: number;
}

export async function handleRoute(
  accountId: string,
  taskType: string,
  params: Record<string, any>,
): Promise<RouteResponse> {
  if (!PROVIDERS_BY_TASK[taskType]) {
    throw new Error(`no candidates for task_type: ${taskType}`);
  }

  // Delegate non-finance:price task types to handleRouteFetch.
  // It already supports per-task-type dispatch, response transforms, region
  // context, etc. We map its response into RouteResponse shape.
  if (taskType !== "finance:price") {
    const stubSource = DELEGATE_SOURCE[taskType];
    if (!stubSource) throw new Error(`no stub source for ${taskType}`);
    const r = await handleRouteFetch(accountId, stubSource, taskType, params);
    return {
      provider: r.routed_to,
      rates: r.rates_after,
      success: r.ok,
      latency_ms: 0,
      result: r.body,
      call_index: r.call_index,
    };
  }

  const perProvider = ACTION_BY_PROVIDER[taskType];
  if (!perProvider) throw new Error(`no actions defined for ${taskType}`);

  const { chosen } = await selectProvider(accountId, taskType, "global");
  const action = perProvider[chosen];
  const provider = getProvider(chosen);
  if (!provider || !action) {
    throw new Error(`provider ${chosen} not configured for ${taskType}`);
  }

  const norm = normalizeParams(chosen, taskType, params);
  let success = false;
  let result: any;
  let latencyMs = 0;

  if (!norm.ok) {
    result = { error: norm.error };
  } else {
    const start = Date.now();
    let raw;
    try {
      raw = await provider.query(action, norm.params);
    } catch (e: any) {
      raw = { success: false, error: e?.message ?? String(e) };
    }
    latencyMs = Date.now() - start;
    const out = normalizeResult(chosen, norm.symbol, norm.currency, raw);
    success = out.success;
    result = out.result;
  }

  const { rates_after, call_index } = await recordOutcome({
    accountId,
    taskType,
    provider: chosen,
    success,
    latencyMs,
    context: "global",
  });

  return {
    provider: chosen,
    rates: rates_after,
    success,
    latency_ms: latencyMs,
    result,
    call_index,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }
  const body = req.body ?? {};
  const taskType: string | undefined = body.task_type;
  const params: Record<string, any> = body.params ?? {};
  if (!taskType) return res.status(400).json({ error: "task_type required" });
  if (!PROVIDERS_BY_TASK[taskType]) {
    return res.status(400).json({ error: `no action for ${taskType}` });
  }

  try {
    const out = await handleRoute(auth.account!.id, taskType, params);
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
