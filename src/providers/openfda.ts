import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";
import { config } from "../config.js";

export class OpenFDAProvider implements Provider {
  info: ProviderInfo = {
    id: "openfda",
    name: "OpenFDA",
    category: ProviderCategory.PHYSICAL_HEALTH,
    description:
      "Access FDA data on drugs, adverse events, and recalls. Powered by the U.S. Food & Drug Administration.",
    availableActions: [
      {
        action: "drug_search",
        description: "Search for drug information by brand name",
        parameters: {
          query: { type: "string" as const, description: "Drug brand name to search", required: true },
          limit: { type: "number" as const, description: "Max results (default 5)", required: false },
        },
      },
      {
        action: "adverse_events",
        description: "Search adverse event reports for a drug",
        parameters: {
          drug: { type: "string" as const, description: "Drug name", required: true },
          limit: { type: "number" as const, description: "Max results (default 5)", required: false },
        },
      },
      {
        action: "recalls",
        description: "Search drug recall enforcement reports",
        parameters: {
          query: { type: "string" as const, description: "Search term for recall reason", required: true },
          limit: { type: "number" as const, description: "Max results (default 5)", required: false },
        },
      },
    ],
    costPerQuery: 1,
    rateLimitPerMinute: 40,
    requiresApiKey: false,
    apiKeyEnvVar: "OPENFDA_API_KEY",
  };

  async initialize(): Promise<void> {}

  isAvailable(): boolean {
    return true; // OpenFDA works without an API key
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    const base = "https://api.fda.gov";
    const limit = (params.limit as number) || 5;
    const apiKeyParam = config.openFdaKey ? `&api_key=${config.openFdaKey}` : "";

    let url: string;

    switch (action) {
      case "drug_search": {
        const query = params.query as string;
        if (!query) return { success: false, error: "Missing required parameter: query", creditsUsed: 0 };
        url = `${base}/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(query)}"&limit=${limit}${apiKeyParam}`;
        break;
      }
      case "adverse_events": {
        const drug = params.drug as string;
        if (!drug) return { success: false, error: "Missing required parameter: drug", creditsUsed: 0 };
        url = `${base}/drug/event.json?search=patient.drug.openfda.brand_name:"${encodeURIComponent(drug)}"&limit=${limit}${apiKeyParam}`;
        break;
      }
      case "recalls": {
        const query = params.query as string;
        if (!query) return { success: false, error: "Missing required parameter: query", creditsUsed: 0 };
        url = `${base}/drug/enforcement.json?search=reason_for_recall:"${encodeURIComponent(query)}"&limit=${limit}${apiKeyParam}`;
        break;
      }
      default:
        return { success: false, error: `Unknown action: ${action}`, creditsUsed: 0 };
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `FDA API error (${res.status}): ${text}`, creditsUsed: 0 };
      }
      const data = await res.json();
      return { success: true, data: data.results, creditsUsed: 1 };
    } catch (err) {
      return { success: false, error: `Request failed: ${(err as Error).message}`, creditsUsed: 0 };
    }
  }
}
