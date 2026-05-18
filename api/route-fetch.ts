import { authenticateRequest } from "../lib/auth.js";
import { getProvider } from "../lib/providers/registry.js";
import { selectProvider, recordOutcome } from "../lib/routing/router.js";
import { transformPlacesResponse } from "../lib/transforms/places.js";
import { transformWeather } from "../lib/transforms/weather.js";
import {
  transformCrypto,
  transformStock,
} from "../lib/transforms/finance.js";

// Region lookup for queries that carry a place-name. First substring hit wins.
const REGION_KEYWORDS: { keys: string[]; region: string }[] = [
  { keys: ["san francisco", "sf", "bay area", "oakland", "berkeley"], region: "us-west" },
  { keys: ["new york", "nyc", "brooklyn"], region: "us-east" },
  { keys: ["tokyo", "osaka", "kyoto"], region: "asia-east" },
  { keys: ["mumbai", "delhi", "bangalore"], region: "asia-south" },
  { keys: ["lagos", "nairobi", "cairo"], region: "africa" },
  { keys: ["paris", "london", "berlin", "madrid"], region: "europe-west" },
];

function deriveTextContext(text: string): string {
  const t = text.toLowerCase();
  for (const { keys, region } of REGION_KEYWORDS) {
    for (const k of keys) {
      if (t.includes(k)) return region;
    }
  }
  return "global";
}

// Rough lat/lon → region. Same buckets as REGION_KEYWORDS so reverse-geocode
// and forward-geocode share routing memory.
function deriveLatLonContext(lat: number, lon: number): string {
  if (lat >= 30 && lat <= 50 && lon >= -130 && lon <= -110) return "us-west";
  if (lat >= 25 && lat <= 50 && lon >= -90 && lon <= -65) return "us-east";
  if (lat >= 25 && lat <= 45 && lon >= 125 && lon <= 150) return "asia-east";
  if (lat >= 5 && lat <= 35 && lon >= 65 && lon <= 95) return "asia-south";
  if (lat >= -35 && lat <= 35 && lon >= -20 && lon <= 50) return "africa";
  if (lat >= 35 && lat <= 60 && lon >= -10 && lon <= 30) return "europe-west";
  return "global";
}

// Map the host-derived `source` name to the provider id in the registry.
const SOURCE_TO_PROVIDER: Record<string, string> = {
  geoapify: "geoapify",
  mapbox: "mapbox",
  nominatim: "openstreetmap",
  openweather: "environment",
  openmeteo: "open_meteo",
  coingecko: "coingecko",
  binance: "binance",
  finnhub: "finnhub",
  alphavantage: "alpha_vantage",
};

type TaskCfg = {
  action: string;
  buildParams: (input: any) => Record<string, unknown>;
  context: (input: any) => string;
  transform: (body: any, chosen: string, source: string) => any;
};

const TASK_CONFIG: Record<string, TaskCfg> = {
  "places:geocode": {
    action: "geocode",
    buildParams: (p) => ({
      text: String(p.text ?? ""),
      query: String(p.text ?? ""),
    }),
    context: (p) => deriveTextContext(String(p.text ?? "")),
    transform: transformPlacesResponse,
  },
  "env:weather": {
    action: "current_weather",
    buildParams: (p) => ({
      city: p.city,
      lat: p.lat,
      lon: p.lon,
    }),
    context: (p) => {
      if (typeof p.lat === "number" && typeof p.lon === "number") {
        return deriveLatLonContext(p.lat, p.lon);
      }
      return deriveTextContext(String(p.city ?? ""));
    },
    transform: transformWeather,
  },
  "finance:price:crypto": {
    action: "coin_price",
    buildParams: (p) => ({
      coins: String(p.coins ?? ""),
      currency: String(p.currency ?? "usd"),
    }),
    context: () => "global",
    transform: transformCrypto,
  },
  "finance:price:stock": {
    action: "stock_quote",
    buildParams: (p) => ({ symbol: String(p.symbol ?? "") }),
    context: () => "global",
    transform: transformStock,
  },
};

export interface RouteFetchResponse {
  ok: boolean;
  status: number;
  body: any;
  routed_to: string;
  original: string;
  call_index: number;
  context: string;
  rates_after: Record<string, number>;
}

export async function handleRouteFetch(
  accountId: string,
  source: string,
  task_type: string,
  params: any,
): Promise<RouteFetchResponse> {
  const cfg = TASK_CONFIG[task_type];
  if (!cfg) throw new Error(`unsupported task_type: ${task_type}`);

  const context = cfg.context(params);
  const { chosen } = await selectProvider(accountId, task_type, context);
  const provider = getProvider(chosen);
  if (!provider) throw new Error(`provider not registered: ${chosen}`);

  let success = false;
  let status = 500;
  let routedBody: any = null;
  let latencyMs = 0;
  const start = Date.now();
  try {
    const raw = await provider.query(cfg.action, cfg.buildParams(params));
    latencyMs = Date.now() - start;
    success = !!raw.success;
    status = success ? 200 : 502;
    routedBody = raw.success
      ? raw.data
      : { error: raw.error ?? "provider error" };
  } catch (e: any) {
    latencyMs = Date.now() - start;
    routedBody = { error: e?.message ?? String(e) };
  }

  const body = success
    ? cfg.transform(routedBody, chosen, source)
    : routedBody;

  const { rates_after, call_index } = await recordOutcome({
    accountId,
    taskType: task_type,
    provider: chosen,
    success,
    latencyMs,
    context,
  });

  return {
    ok: success,
    status,
    body,
    routed_to: chosen,
    original: source,
    call_index,
    context,
    rates_after,
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
  res.setHeader("X-RateLimit-Remaining", String(auth.remaining ?? 0));

  const body = req.body ?? {};
  const { source, task_type, params } = body;
  if (!source || !task_type || !params) {
    return res
      .status(400)
      .json({ error: "source, task_type, params required" });
  }

  // Sanity: ensure source is something we know how to translate back to.
  // (Unknown source means the SDK probably parsed a host we don't have a
  // transform for yet.)
  if (!SOURCE_TO_PROVIDER[source]) {
    return res.status(400).json({ error: `unknown source: ${source}` });
  }

  try {
    const out = await handleRouteFetch(
      auth.account!.id,
      source,
      task_type,
      params,
    );
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
