import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";
import { keyPool, withKeyRetry } from "../key-pool.js";

const ENV = "FINNHUB_API_KEY";

export class FinnhubProvider implements Provider {
  info: ProviderInfo = {
    id: "finnhub",
    name: "Finnhub",
    category: ProviderCategory.FINANCIAL,
    description:
      "Real-time stock quotes, forex rates, company news, and earnings data. 60 calls/min free.",
    availableActions: [
      {
        action: "stock_quote",
        description: "Get real-time stock quote for a symbol",
        parameters: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, TSLA, MSFT)",
            required: true,
          },
        },
      },
      {
        action: "company_news",
        description: "Get latest news articles for a company",
        parameters: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol",
            required: true,
          },
          from: {
            type: "string",
            description: "Start date YYYY-MM-DD (default: 7 days ago)",
            required: false,
          },
          to: {
            type: "string",
            description: "End date YYYY-MM-DD (default: today)",
            required: false,
          },
        },
      },
      {
        action: "forex_rate",
        description: "Get exchange rate between two currencies",
        parameters: {
          from: {
            type: "string",
            description: "Source currency (e.g., USD)",
            required: true,
          },
          to: {
            type: "string",
            description: "Target currency (e.g., EUR)",
            required: true,
          },
        },
      },
      {
        action: "market_news",
        description: "Get general market news",
        parameters: {
          category: {
            type: "string",
            description:
              "News category: general, forex, crypto, merger (default: general)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return keyPool.hasKeys(ENV);
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (!keyPool.hasKeys(ENV))
      return { success: false, error: "Finnhub API key not configured" };

    const base = "https://finnhub.io/api/v1";

    try {
      switch (action) {
        case "stock_quote": {
          const symbol = params.symbol as string;
          if (!symbol)
            return {
              success: false,
              error: "Missing required parameter: symbol",
            };
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Finnhub error (${res.status})` };
          const data = await res.json();
          return {
            success: true,
            data: {
              symbol,
              current_price: data.c,
              change: data.d,
              percent_change: data.dp,
              high: data.h,
              low: data.l,
              open: data.o,
              previous_close: data.pc,
            },
          };
        }

        case "company_news": {
          const symbol = params.symbol as string;
          if (!symbol)
            return {
              success: false,
              error: "Missing required parameter: symbol",
            };
          const to =
            (params.to as string) || new Date().toISOString().slice(0, 10);
          const fromDate = new Date();
          fromDate.setDate(fromDate.getDate() - 7);
          const from =
            (params.from as string) || fromDate.toISOString().slice(0, 10);
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Finnhub error (${res.status})` };
          const data = await res.json();
          return { success: true, data: data.slice(0, 10) };
        }

        case "forex_rate": {
          const from = params.from as string;
          const to = params.to as string;
          if (!from || !to)
            return {
              success: false,
              error: "Missing required parameters: from, to",
            };
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/forex/rates?base=${encodeURIComponent(from)}&token=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Finnhub error (${res.status})` };
          const data = await res.json();
          const rate = data.quote?.[to];
          if (!rate)
            return { success: false, error: `Currency '${to}' not found` };
          return { success: true, data: { from, to, rate } };
        }

        case "market_news": {
          const category = (params.category as string) || "general";
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/news?category=${encodeURIComponent(category)}&token=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Finnhub error (${res.status})` };
          const data = await res.json();
          return { success: true, data: data.slice(0, 10) };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
