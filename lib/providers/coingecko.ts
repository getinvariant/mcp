import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";
import { keyPool, withKeyRetry } from "../key-pool.js";

const ENV = "COINGECKO_API_KEY";

export class CoinGeckoProvider implements Provider {
  info: ProviderInfo = {
    id: "coingecko",
    name: "CoinGecko",
    category: ProviderCategory.FINANCIAL,
    description:
      "Real-time and historical cryptocurrency prices, market data, and trending coins. No API key required.",
    availableActions: [
      {
        action: "coin_price",
        description: "Get current price of one or more coins in any currency",
        parameters: {
          coins: {
            type: "string",
            description:
              "Comma-separated coin IDs (e.g., 'bitcoin,ethereum,solana')",
            required: true,
          },
          currency: {
            type: "string",
            description: "Target currency (default: usd)",
            required: false,
          },
        },
      },
      {
        action: "trending",
        description: "Get the top 7 trending coins in the last 24 hours",
        parameters: {},
      },
      {
        action: "coin_search",
        description: "Search for a coin by name or symbol",
        parameters: {
          query: {
            type: "string",
            description:
              "Coin name or symbol to search (e.g., 'bitcoin', 'BTC')",
            required: true,
          },
        },
      },
      {
        action: "market_overview",
        description: "Get top coins by market cap with price and 24h change",
        parameters: {
          limit: {
            type: "number",
            description: "Number of coins to return (default: 10, max: 50)",
            required: false,
          },
          currency: {
            type: "string",
            description: "Target currency (default: usd)",
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

  private async cgFetch(url: string): Promise<{ res: Response }> {
    if (keyPool.hasKeys(ENV)) {
      return withKeyRetry(ENV, (apiKey) =>
        fetch(url, {
          headers: {
            Accept: "application/json",
            "x-cg-demo-api-key": apiKey,
          },
        }),
      ).then(({ response }) => ({ res: response }));
    }

    return { res: await fetch(url, { headers: { Accept: "application/json" } }) };
  }

  private async cgQuery(url: string): Promise<QueryResult> {
    try {
      const { res } = await this.cgFetch(url);
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `CoinGecko error (${res.status}): ${text}`,
        };
      }
      const data = await res.json();
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const base = "https://api.coingecko.com/api/v3";

    switch (action) {
      case "coin_price": {
        const coins = params.coins as string;
        if (!coins)
          return { success: false, error: "Missing required parameter: coins" };
        const currency = (params.currency as string) || "usd";
        return this.cgQuery(
          `${base}/simple/price?ids=${encodeURIComponent(coins)}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true`,
        );
      }

      case "trending":
        return this.cgQuery(`${base}/search/trending`);

      case "coin_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };
        const result = await this.cgQuery(
          `${base}/search?query=${encodeURIComponent(query)}`,
        );
        if (!result.success) return result;
        return {
          success: true,
          data: (result.data as any).coins?.slice(0, 10),
        };
      }

      case "market_overview": {
        const limit = Math.min((params.limit as number) || 10, 50);
        const currency = (params.currency as string) || "usd";
        return this.cgQuery(
          `${base}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`,
        );
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
