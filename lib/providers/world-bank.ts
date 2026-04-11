import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class WorldBankProvider implements Provider {
  info: ProviderInfo = {
    id: "world_bank",
    name: "World Bank",
    category: ProviderCategory.FINANCIAL,
    description:
      "Access World Bank development indicators — GDP, population, poverty, education, and health metrics for 300+ economies.",
    availableActions: [
      {
        action: "indicator",
        description:
          "Get a development indicator for a country (e.g. GDP, population)",
        parameters: {
          country: {
            type: "string",
            description:
              "ISO 3166-1 alpha-2 country code (e.g. US, IN, BR) or 'all'",
            required: true,
          },
          indicator: {
            type: "string",
            description:
              "Indicator code (e.g. NY.GDP.MKTP.CD for GDP, SP.POP.TOTL for population, SI.POV.DDAY for poverty rate)",
            required: true,
          },
          date: {
            type: "string",
            description:
              "Year or range (e.g. '2020' or '2015:2023'). Default: last 5 years",
            required: false,
          },
        },
      },
      {
        action: "country_info",
        description:
          "Get basic info about a country (region, income level, capital)",
        parameters: {
          country: {
            type: "string",
            description: "ISO alpha-2 country code (e.g. US, IN, BR)",
            required: true,
          },
        },
      },
      {
        action: "indicator_search",
        description: "Search for available indicator codes by keyword",
        parameters: {
          query: {
            type: "string",
            description:
              "Keyword to search indicators (e.g. 'gdp', 'poverty', 'education')",
            required: true,
          },
        },
      },
    ],
    requiresApiKey: false,
  };

  isAvailable(): boolean {
    return true;
  }

  private async wbFetch(url: string): Promise<QueryResult> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `World Bank API error (${res.status}): ${text}`,
        };
      }
      const data = await res.json();
      if (data[0]?.message) {
        return {
          success: false,
          error: data[0].message[0]?.value || "Unknown error",
        };
      }
      return { success: true, data: data[1] || data };
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
    const base = "https://api.worldbank.org/v2";

    switch (action) {
      case "indicator": {
        const country = params.country as string;
        const indicator = params.indicator as string;
        if (!country)
          return { success: false, error: "Missing required parameter: country" };
        if (!indicator)
          return { success: false, error: "Missing required parameter: indicator" };

        const date = (params.date as string) || "2019:2023";
        return this.wbFetch(
          `${base}/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?date=${date}&format=json&per_page=50`,
        );
      }

      case "country_info": {
        const country = params.country as string;
        if (!country)
          return { success: false, error: "Missing required parameter: country" };
        return this.wbFetch(
          `${base}/country/${encodeURIComponent(country)}?format=json`,
        );
      }

      case "indicator_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };
        const result = await this.wbFetch(
          `${base}/indicator?format=json&per_page=20`,
        );
        if (!result.success) return result;
        const all = result.data as any[];
        const filtered = all.filter(
          (i: any) =>
            i.name?.toLowerCase().includes(query.toLowerCase()) ||
            i.id?.toLowerCase().includes(query.toLowerCase()) ||
            i.sourceNote?.toLowerCase().includes(query.toLowerCase()),
        );
        return {
          success: true,
          data: filtered.slice(0, 20).map((i: any) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            source: i.source?.value,
            description: i.sourceNote?.slice(0, 200),
          })),
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
