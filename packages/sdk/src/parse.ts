import type { RouteFetchRequest, Source } from "./types.js";

// Reverse map: binance trading symbol (e.g. "BTCUSDT") -> coingecko id.
// Keep in sync with lib/providers/binance.ts and lib/transforms/finance.ts.
const BINANCE_SYM_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  DOT: "polkadot",
  LINK: "chainlink",
  AVAX: "avalanche",
  MATIC: "polygon",
  LTC: "litecoin",
  UNI: "uniswap",
};

function binancePairToId(pair: string): string | null {
  // "BTCUSDT" -> "bitcoin". Only support USDT-quoted pairs for the demo.
  if (!pair.endsWith("USDT")) return null;
  const base = pair.slice(0, -4);
  return BINANCE_SYM_TO_ID[base] ?? null;
}

export function parseRequest(
  url: string,
  _init?: RequestInit,
): RouteFetchRequest | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  // --- places:geocode ---

  if (u.hostname === "api.geoapify.com") {
    if (u.pathname === "/v1/geocode/search") {
      const text = u.searchParams.get("text");
      if (!text) return null;
      return {
        source: "geoapify",
        task_type: "places:geocode",
        params: { text },
      };
    }
    return null;
  }

  if (u.hostname === "api.mapbox.com") {
    const m = u.pathname.match(/^\/geocoding\/v5\/mapbox\.places\/(.+)\.json$/);
    if (m) {
      const text = decodeURIComponent(m[1]);
      return { source: "mapbox", task_type: "places:geocode", params: { text } };
    }
    return null;
  }

  if (u.hostname === "nominatim.openstreetmap.org") {
    if (u.pathname === "/search") {
      const text = u.searchParams.get("q") ?? u.searchParams.get("text");
      if (!text) return null;
      return {
        source: "nominatim",
        task_type: "places:geocode",
        params: { text },
      };
    }
    return null;
  }

  // --- env:weather ---

  if (u.hostname === "api.openweathermap.org") {
    if (u.pathname === "/data/2.5/weather") {
      const city = u.searchParams.get("q") ?? undefined;
      const latStr = u.searchParams.get("lat");
      const lonStr = u.searchParams.get("lon");
      const lat = latStr != null ? parseFloat(latStr) : undefined;
      const lon = lonStr != null ? parseFloat(lonStr) : undefined;
      if (!city && (lat == null || lon == null)) return null;
      return {
        source: "openweather",
        task_type: "env:weather",
        params: { city, lat, lon },
      };
    }
    return null;
  }

  if (u.hostname === "api.open-meteo.com") {
    if (u.pathname === "/v1/forecast") {
      const latStr = u.searchParams.get("latitude");
      const lonStr = u.searchParams.get("longitude");
      if (latStr == null || lonStr == null) return null;
      return {
        source: "openmeteo",
        task_type: "env:weather",
        params: { lat: parseFloat(latStr), lon: parseFloat(lonStr) },
      };
    }
    return null;
  }

  // --- finance:price:crypto ---

  if (u.hostname === "api.coingecko.com") {
    if (u.pathname === "/api/v3/simple/price") {
      const coins = u.searchParams.get("ids");
      if (!coins) return null;
      const currency = u.searchParams.get("vs_currencies") ?? "usd";
      return {
        source: "coingecko",
        task_type: "finance:price:crypto",
        params: { coins, currency },
      };
    }
    return null;
  }

  if (u.hostname === "api.binance.com") {
    if (u.pathname === "/api/v3/ticker/price") {
      const single = u.searchParams.get("symbol");
      const many = u.searchParams.get("symbols");
      const pairs: string[] = [];
      if (single) pairs.push(single);
      if (many) {
        try {
          const parsed = JSON.parse(many);
          if (Array.isArray(parsed)) for (const s of parsed) pairs.push(String(s));
        } catch {
          /* ignore */
        }
      }
      if (pairs.length === 0) return null;
      const ids = pairs.map(binancePairToId).filter(Boolean) as string[];
      if (ids.length === 0) return null;
      return {
        source: "binance",
        task_type: "finance:price:crypto",
        params: { coins: ids.join(","), currency: "usd" },
      };
    }
    return null;
  }

  // --- finance:price:stock ---

  if (u.hostname === "finnhub.io") {
    if (u.pathname === "/api/v1/quote") {
      const symbol = u.searchParams.get("symbol");
      if (!symbol) return null;
      return {
        source: "finnhub",
        task_type: "finance:price:stock",
        params: { symbol },
      };
    }
    return null;
  }

  if (u.hostname === "www.alphavantage.co") {
    if (u.pathname === "/query") {
      const fn = u.searchParams.get("function");
      const symbol = u.searchParams.get("symbol");
      if (fn !== "GLOBAL_QUOTE" || !symbol) return null;
      return {
        source: "alphavantage",
        task_type: "finance:price:stock",
        params: { symbol },
      };
    }
    return null;
  }

  return null;
}
