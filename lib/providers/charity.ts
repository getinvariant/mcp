import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";
import { keyPool, withKeyRetry } from "../key-pool.js";

const ENV = "EVERY_ORG_API_KEY";

export class CharityProvider implements Provider {
  info: ProviderInfo = {
    id: "charity",
    name: "Every.org Nonprofit Search",
    category: ProviderCategory.SOCIAL_IMPACT,
    description:
      "Search and discover nonprofits and charities. Powered by Every.org's nonprofit database.",
    availableActions: [
      {
        action: "search_nonprofits",
        description: "Search for nonprofits by cause, name, or keyword",
        parameters: {
          query: {
            type: "string",
            description: "Search term (e.g., 'climate change', 'education')",
            required: true,
          },
          take: {
            type: "number",
            description: "Number of results (default 10)",
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
    if (action !== "search_nonprofits") {
      return { success: false, error: `Unknown action: ${action}` };
    }

    if (!keyPool.hasKeys(ENV))
      return { success: false, error: "Every.org API key not configured" };

    const query = params.query as string;
    if (!query)
      return { success: false, error: "Missing required parameter: query" };

    const take = (params.take as number) || 10;

    try {
      const { response: res } = await withKeyRetry(ENV, (apiKey) =>
        fetch(
          `https://partners.every.org/v0.2/search/${encodeURIComponent(query)}?apiKey=${apiKey}&take=${take}`,
        ),
      );
      if (!res.ok)
        return { success: false, error: `Every.org API error (${res.status})` };
      const data = await res.json();
      return { success: true, data: data.nonprofits };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
