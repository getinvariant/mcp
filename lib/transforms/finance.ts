// Finance transforms. Two task types share this module:
//   finance:price:crypto  (coingecko ↔ binance)
//   finance:price:stock   (finnhub  ↔ alpha_vantage)

const ID_TO_SYMBOL: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  cardano: "ADA",
  ripple: "XRP",
  dogecoin: "DOGE",
  polkadot: "DOT",
  chainlink: "LINK",
  avalanche: "AVAX",
  polygon: "MATIC",
  litecoin: "LTC",
  uniswap: "UNI",
};

type NormalizedCrypto = Record<
  string,
  { usd?: number; change_24h_pct?: number }
>;

function normalizeCrypto(body: any, provider: string): NormalizedCrypto {
  if (provider === "coingecko") {
    const out: NormalizedCrypto = {};
    for (const [id, v] of Object.entries(body ?? {})) {
      const obj = (v ?? {}) as any;
      out[id] = {
        usd: obj.usd,
        change_24h_pct: obj.usd_24h_change,
      };
    }
    return out;
  }
  if (provider === "binance") {
    // BinanceProvider's output is already keyed-by-id with {usd}.
    const out: NormalizedCrypto = {};
    for (const [id, v] of Object.entries(body ?? {})) {
      const obj = (v ?? {}) as any;
      out[id] = { usd: obj.usd };
    }
    return out;
  }
  return {};
}

function toCryptoSourceShape(n: NormalizedCrypto, source: string): any {
  if (source === "coingecko") {
    const out: Record<string, any> = {};
    for (const [id, v] of Object.entries(n)) {
      const row: any = {};
      if (v.usd !== undefined) row.usd = v.usd;
      if (v.change_24h_pct !== undefined) row.usd_24h_change = v.change_24h_pct;
      out[id] = row;
    }
    return out;
  }
  if (source === "binance") {
    const out: { symbol: string; price: string }[] = [];
    for (const [id, v] of Object.entries(n)) {
      const sym = ID_TO_SYMBOL[id];
      if (sym && v.usd !== undefined) {
        out.push({ symbol: `${sym}USDT`, price: v.usd.toFixed(8) });
      }
    }
    return out;
  }
  return n;
}

export function transformCrypto(
  body: any,
  chosen: string,
  source: string,
): any {
  return toCryptoSourceShape(normalizeCrypto(body, chosen), source);
}

type NormalizedStock = {
  symbol: string;
  current_price: number;
  change?: number;
  percent_change?: number;
  high?: number;
  low?: number;
  open?: number;
  previous_close?: number;
};

function num(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  return NaN;
}

function normalizeStock(body: any, provider: string): NormalizedStock {
  if (provider === "finnhub") {
    return {
      symbol: body?.symbol,
      current_price: num(body?.current_price),
      change: num(body?.change),
      percent_change: num(body?.percent_change),
      high: num(body?.high),
      low: num(body?.low),
      open: num(body?.open),
      previous_close: num(body?.previous_close),
    };
  }
  if (provider === "alpha_vantage") {
    const q = body?.["Global Quote"] ?? {};
    const pct = String(q["10. change percent"] ?? "").replace("%", "");
    return {
      symbol: q["01. symbol"],
      open: num(q["02. open"]),
      high: num(q["03. high"]),
      low: num(q["04. low"]),
      current_price: num(q["05. price"]),
      previous_close: num(q["08. previous close"]),
      change: num(q["09. change"]),
      percent_change: num(pct),
    };
  }
  return body;
}

function toStockSourceShape(n: NormalizedStock, source: string): any {
  if (source === "finnhub") {
    return {
      c: n.current_price,
      d: n.change ?? 0,
      dp: n.percent_change ?? 0,
      h: n.high ?? 0,
      l: n.low ?? 0,
      o: n.open ?? 0,
      pc: n.previous_close ?? 0,
      t: Math.floor(Date.now() / 1000),
    };
  }
  if (source === "alphavantage") {
    return {
      "Global Quote": {
        "01. symbol": n.symbol,
        "02. open": (n.open ?? 0).toFixed(2),
        "03. high": (n.high ?? 0).toFixed(2),
        "04. low": (n.low ?? 0).toFixed(2),
        "05. price": (n.current_price ?? 0).toFixed(2),
        "08. previous close": (n.previous_close ?? 0).toFixed(2),
        "09. change": (n.change ?? 0).toFixed(2),
        "10. change percent": (n.percent_change ?? 0).toFixed(2) + "%",
      },
    };
  }
  return n;
}

export function transformStock(
  body: any,
  chosen: string,
  source: string,
): any {
  return toStockSourceShape(normalizeStock(body, chosen), source);
}
