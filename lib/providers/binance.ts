import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

// Small map of common crypto IDs to Binance trading symbols.
// Binance trades against USDT (USD-pegged) for nearly all majors, so we
// pretend USDT == USD for the demo. Add entries here as needed.
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

export class BinanceProvider implements Provider {
  info: ProviderInfo = {
    id: "binance",
    name: "Binance Public",
    category: ProviderCategory.FINANCIAL,
    description:
      "Real-time crypto prices via Binance public API. No API key required.",
    availableActions: [
      {
        action: "coin_price",
        description: "Get current price of one or more coins in USD-equivalent",
        parameters: {
          coins: {
            type: "string",
            description: "Comma-separated coin IDs (e.g., 'bitcoin,ethereum')",
            required: true,
          },
          currency: {
            type: "string",
            description: "Target currency (only 'usd' supported)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (action !== "coin_price") {
      return { success: false, error: `unknown action ${action}` };
    }
    const coins = String(params.coins ?? "");
    if (!coins) return { success: false, error: "coins required" };

    const ids = coins.split(",").map((s) => s.trim().toLowerCase());
    const symbols = ids.map((id) => ID_TO_SYMBOL[id]).filter(Boolean);
    if (symbols.length === 0) {
      return {
        success: false,
        error: `no binance symbol for any of: ${ids.join(", ")}`,
      };
    }

    const tickerParam = `[${symbols.map((s) => `"${s}USDT"`).join(",")}]`;
    const url = `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(tickerParam)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, error: `binance error (${res.status})` };
      }
      const data: any = await res.json();
      if (!Array.isArray(data)) {
        return { success: false, error: "binance returned non-array" };
      }
      const byId: Record<string, { usd: number }> = {};
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const sym = ID_TO_SYMBOL[id];
        if (!sym) continue;
        const row = data.find((r: any) => r.symbol === `${sym}USDT`);
        if (row) byId[id] = { usd: parseFloat(row.price) };
      }
      return { success: true, data: byId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
