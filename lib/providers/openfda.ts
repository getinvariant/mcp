import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";
import { keyPool, withKeyRetry } from "../key-pool.js";

const ENV = "OPENFDA_API_KEY";

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
          query: {
            type: "string",
            description: "Drug brand name to search",
            required: true,
          },
          limit: {
            type: "number",
            description: "Max results (default 5)",
            required: false,
          },
        },
      },
      {
        action: "adverse_events",
        description: "Search adverse event reports for a drug",
        parameters: {
          drug: { type: "string", description: "Drug name", required: true },
          limit: {
            type: "number",
            description: "Max results (default 5)",
            required: false,
          },
        },
      },
      {
        action: "recalls",
        description: "Search drug recall enforcement reports",
        parameters: {
          query: {
            type: "string",
            description: "Search term for recall reason",
            required: true,
          },
          limit: {
            type: "number",
            description: "Max results (default 5)",
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
    const base = "https://api.fda.gov";
    const limit = (params.limit as number) || 5;

    let urlBuilder: (apiKeyParam: string) => string;

    switch (action) {
      case "drug_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };
        urlBuilder = (akp) =>
          `${base}/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(query)}"&limit=${limit}${akp}`;
        break;
      }
      case "adverse_events": {
        const drug = params.drug as string;
        if (!drug)
          return { success: false, error: "Missing required parameter: drug" };
        urlBuilder = (akp) =>
          `${base}/drug/event.json?search=patient.drug.openfda.brand_name:"${encodeURIComponent(drug)}"&limit=${limit}${akp}`;
        break;
      }
      case "recalls": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };
        urlBuilder = (akp) =>
          `${base}/drug/enforcement.json?search=reason_for_recall:"${encodeURIComponent(query)}"&limit=${limit}${akp}`;
        break;
      }
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }

    try {
      let res: Response;

      if (keyPool.hasKeys(ENV)) {
        const result = await withKeyRetry(ENV, (apiKey) =>
          fetch(urlBuilder(`&api_key=${apiKey}`)),
        );
        res = result.response;
      } else {
        res = await fetch(urlBuilder(""));
      }

      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `FDA API error (${res.status}): ${text}`,
        };
      }
      const data = await res.json();
      return { success: true, data: data.results };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
