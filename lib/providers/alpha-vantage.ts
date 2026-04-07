import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";

export class AlphaVantageProvider implements Provider {
  info: ProviderInfo = {
    id: "alpha_vantage",
    name: "Alpha Vantage",
    category: ProviderCategory.FINANCIAL,
    description: "Real-time and historical stock quotes, forex rates, and financial data.",
    availableActions: [
      {
        action: "stock_quote",
        description: "Get the latest price quote for a stock symbol",
        parameters: {
          symbol: { type: "string", description: "Stock ticker symbol (e.g., AAPL, MSFT)", required: true },
        },
      },
      {
        action: "stock_search",
        description: "Search for stock symbols by company name or keyword",
        parameters: {
          keywords: { type: "string", description: "Company name or keyword to search", required: true },
        },
      },
      {
        action: "forex_rate",
        description: "Get the exchange rate between two currencies",
        parameters: {
          from: { type: "string", description: "Source currency code (e.g., USD)", required: true },
          to: { type: "string", description: "Target currency code (e.g., EUR)", required: true },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.ALPHA_VANTAGE_API_KEY;
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return { success: false, error: "Alpha Vantage API key not configured" };

    const base = "https://www.alphavantage.co/query";
    let url: string;

    switch (action) {
      case "stock_quote": {
        const symbol = params.symbol as string;
        if (!symbol) return { success: false, error: "Missing required parameter: symbol" };
        url = `${base}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
        break;
      }
      case "stock_search": {
        const keywords = params.keywords as string;
        if (!keywords) return { success: false, error: "Missing required parameter: keywords" };
        url = `${base}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${apiKey}`;
        break;
      }
      case "forex_rate": {
        const from = params.from as string;
        const to = params.to as string;
        if (!from || !to) return { success: false, error: "Missing required parameters: from, to" };
        url = `${base}?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(from)}&to_currency=${encodeURIComponent(to)}&apikey=${apiKey}`;
        break;
      }
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }

    try {
      const res = await fetch(url);
      if (!res.ok) return { success: false, error: `Alpha Vantage API error (${res.status})` };
      const data = await res.json();
      if (data["Error Message"]) return { success: false, error: data["Error Message"] };
      if (data["Note"]) return { success: false, error: `Rate limit reached: ${data["Note"]}` };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: `Request failed: ${(err as Error).message}` };
    }
  }
}
