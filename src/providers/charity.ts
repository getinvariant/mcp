import { Provider, ProviderCategory, QueryResult } from "./types.js";
import { config } from "../config.js";

export class CharityProvider implements Provider {
  info = {
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
          query: { type: "string" as const, description: "Search term (e.g., 'climate change', 'education')", required: true },
          take: { type: "number" as const, description: "Number of results (default 10)", required: false },
        },
      },
    ],
    costPerQuery: 1,
    rateLimitPerMinute: 30,
    requiresApiKey: true,
    apiKeyEnvVar: "EVERY_ORG_API_KEY",
  };

  async initialize(): Promise<void> {}

  isAvailable(): boolean {
    return !!config.everyOrgKey;
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    if (action !== "search_nonprofits") {
      return { success: false, error: `Unknown action: ${action}`, creditsUsed: 0 };
    }

    if (!config.everyOrgKey) {
      return { success: false, error: "Every.org API key not configured", creditsUsed: 0 };
    }

    const query = params.query as string;
    if (!query) return { success: false, error: "Missing required parameter: query", creditsUsed: 0 };

    const take = (params.take as number) || 10;
    const url = `https://partners.every.org/v0.2/search/${encodeURIComponent(query)}?apiKey=${config.everyOrgKey}&take=${take}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, error: `Every.org API error (${res.status})`, creditsUsed: 0 };
      }
      const data = await res.json();
      return { success: true, data: data.nonprofits, creditsUsed: 1 };
    } catch (err) {
      return { success: false, error: `Request failed: ${(err as Error).message}`, creditsUsed: 0 };
    }
  }
}
