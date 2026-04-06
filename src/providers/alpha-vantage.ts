import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";
import { config } from "../config.js";

export class AlphaVantageProvider implements Provider {
  info: ProviderInfo = {
    id: "alpha_vantage",
    name: "Alpha Vantage",
    category: ProviderCategory.FINANCIAL,
    description:
      "Real-time and historical stock quotes, forex rates, and financial data.",
    availableActions: [
      {
        action: "stock_quote",
        description: "Get the latest price quote for a stock symbol",
        parameters: {
          symbol: { type: "string" as const, description: "Stock ticker symbol (e.g., AAPL, MSFT)", required: true },
        },
      },
      {
        action: "stock_search",
        description: "Search for stock symbols by company name or keyword",
        parameters: {
          keywords: { type: "string" as const, description: "Company name or keyword to search", required: true },
        },
      },
      {
        action: "forex_rate",
        description: "Get the exchange rate between two currencies",
        parameters: {
          from: { type: "string" as const, description: "Source currency code (e.g., USD)", required: true },
          to: { type: "string" as const, description: "Target currency code (e.g., EUR)", required: true },
        },
      },
    ],
    costPerQuery: 2,
    rateLimitPerMinute: 25,
    requiresApiKey: true,
    apiKeyEnvVar: "ALPHA_VANTAGE_API_KEY",
  };

  async initialize(): Promise<void> {}

  isAvailable(): boolean {
    return !!config.alphaVantageKey;
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    if (!config.alphaVantageKey) {
      return { success: false, error: "Alpha Vantage API key not configured", creditsUsed: 0 };
    }

    const base = "https://www.alphavantage.co/query";
    let url: string;

    switch (action) {
      case "stock_quote": {
        const symbol = params.symbol as string;
        if (!symbol) return { success: false, error: "Missing required parameter: symbol", creditsUsed: 0 };
        url = `${base}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${config.alphaVantageKey}`;
        break;
      }
      case "stock_search": {
        const keywords = params.keywords as string;
        if (!keywords) return { success: false, error: "Missing required parameter: keywords", creditsUsed: 0 };
        url = `${base}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${config.alphaVantageKey}`;
        break;
      }
      case "forex_rate": {
        const from = params.from as string;
        const to = params.to as string;
        if (!from || !to) return { success: false, error: "Missing required parameters: from, to", creditsUsed: 0 };
        url = `${base}?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(from)}&to_currency=${encodeURIComponent(to)}&apikey=${config.alphaVantageKey}`;
        break;
      }
      default:
        return { success: false, error: `Unknown action: ${action}`, creditsUsed: 0 };
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, error: `Alpha Vantage API error (${res.status})`, creditsUsed: 0 };
      }
      const data = await res.json();
      if (data["Error Message"]) {
        return { success: false, error: data["Error Message"], creditsUsed: 0 };
      }
      if (data["Note"]) {
        return { success: false, error: `Rate limit reached: ${data["Note"]}`, creditsUsed: 0 };
      }
      return { success: true, data, creditsUsed: 2 };
    } catch (err) {
      return { success: false, error: `Request failed: ${(err as Error).message}`, creditsUsed: 0 };
    }
  }
}
