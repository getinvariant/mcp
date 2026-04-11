import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class NPPESProvider implements Provider {
  info: ProviderInfo = {
    id: "nppes",
    name: "NPPES NPI Registry",
    category: ProviderCategory.PHYSICAL_HEALTH,
    description:
      "Search the CMS National Plan and Provider Enumeration System for healthcare provider NPI numbers, specialties, and practice locations.",
    availableActions: [
      {
        action: "provider_search",
        description:
          "Search for healthcare providers by name, NPI, taxonomy, or location",
        parameters: {
          name: {
            type: "string",
            description:
              "Provider last name (individual) or organization name",
            required: false,
          },
          first_name: {
            type: "string",
            description: "Provider first name (individual providers only)",
            required: false,
          },
          npi: {
            type: "string",
            description: "Exact 10-digit NPI number",
            required: false,
          },
          state: {
            type: "string",
            description: "Two-letter US state code (e.g. CA, NY)",
            required: false,
          },
          city: {
            type: "string",
            description: "City name",
            required: false,
          },
          taxonomy: {
            type: "string",
            description:
              "Provider taxonomy/specialty description (e.g. 'Cardiology')",
            required: false,
          },
          limit: {
            type: "number",
            description: "Max results (default 10, max 200)",
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
    if (action !== "provider_search") {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const base = "https://npiregistry.cms.hhs.gov/api";
    const limit = Math.min((params.limit as number) || 10, 200);
    const qp = new URLSearchParams({ version: "2.1", limit: String(limit) });

    if (params.npi) qp.set("number", params.npi as string);
    if (params.name) qp.set("last_name", params.name as string);
    if (params.first_name) qp.set("first_name", params.first_name as string);
    if (params.state) qp.set("state", params.state as string);
    if (params.city) qp.set("city", params.city as string);
    if (params.taxonomy)
      qp.set("taxonomy_description", params.taxonomy as string);

    const hasSearch = ["number", "last_name", "first_name", "state", "city", "taxonomy_description"]
      .some((k) => qp.has(k));
    if (!hasSearch) {
      return {
        success: false,
        error: "At least one search parameter is required (name, npi, state, city, or taxonomy)",
      };
    }

    try {
      const res = await fetch(`${base}/?${qp}`);
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `NPPES API error (${res.status}): ${text}`,
        };
      }
      const data = await res.json();
      if (data.Errors) {
        return {
          success: false,
          error: data.Errors.map((e: any) => e.description).join("; "),
        };
      }
      return { success: true, data: data.results || [] };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
