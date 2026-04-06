import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";

export class OpenStreetMapProvider implements Provider {
  info: ProviderInfo = {
    id: "openstreetmap",
    name: "OpenStreetMap (Nominatim)",
    category: ProviderCategory.MAPS,
    description: "Free geocoding and reverse geocoding using OpenStreetMap data via the Nominatim API. No API key required.",
    availableActions: [
      {
        action: "geocode",
        description: "Convert an address or place name to coordinates",
        parameters: {
          query: { type: "string", description: "Address or place name to geocode", required: true },
          limit: { type: "number", description: "Max results (default 5)", required: false },
        },
      },
      {
        action: "reverse_geocode",
        description: "Convert coordinates to a human-readable address",
        parameters: {
          lat: { type: "number", description: "Latitude", required: true },
          lon: { type: "number", description: "Longitude", required: true },
        },
      },
    ],
    requiresApiKey: false,
  };

  isAvailable(): boolean {
    return true; // Nominatim is free and requires no API key
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    const headers = {
      "User-Agent": "ProcurementLabsMCP/0.1.0 (hackathon)",
      "Accept": "application/json",
    };

    switch (action) {
      case "geocode": {
        const query = params.query as string;
        if (!query) return { success: false, error: "Missing required parameter: query" };
        const limit = (params.limit as number) || 5;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&addressdetails=1`;

        try {
          const res = await fetch(url, { headers });
          if (!res.ok) return { success: false, error: `Nominatim error (${res.status})` };
          const data = await res.json();
          return {
            success: true,
            data: data.map((r: any) => ({
              display_name: r.display_name,
              lat: parseFloat(r.lat),
              lon: parseFloat(r.lon),
              type: r.type,
              address: r.address,
            })),
          };
        } catch (err) {
          return { success: false, error: `Request failed: ${(err as Error).message}` };
        }
      }

      case "reverse_geocode": {
        const lat = params.lat as number;
        const lon = params.lon as number;
        if (lat == null || lon == null) return { success: false, error: "Missing required parameters: lat, lon" };
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;

        try {
          const res = await fetch(url, { headers });
          if (!res.ok) return { success: false, error: `Nominatim error (${res.status})` };
          const data = await res.json();
          return {
            success: true,
            data: {
              display_name: data.display_name,
              address: data.address,
              lat: parseFloat(data.lat),
              lon: parseFloat(data.lon),
            },
          };
        } catch (err) {
          return { success: false, error: `Request failed: ${(err as Error).message}` };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
