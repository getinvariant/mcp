import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class MapboxProvider implements Provider {
  info: ProviderInfo = {
    id: "mapbox",
    name: "Mapbox",
    category: ProviderCategory.MAPS,
    description: "Maps + geocoding from Mapbox.",
    availableActions: [
      {
        action: "geocode",
        description: "Convert an address or place name to coordinates",
        parameters: {
          text: {
            type: "string",
            description: "Address or place name to geocode",
            required: true,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.MAPBOX_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (action !== "geocode") {
      return { success: false, error: `mapbox: unknown action ${action}` };
    }
    const key = process.env.MAPBOX_API_KEY;
    if (!key) return { success: false, error: "MAPBOX_API_KEY not set" };
    const text = String((params as any)?.text ?? "");
    if (!text) return { success: false, error: "params.text required" };
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?access_token=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok)
        return { success: false, error: `mapbox HTTP ${res.status}` };
      const data: any = await res.json();
      if (!Array.isArray(data?.features) || data.features.length === 0) {
        return { success: false, error: "mapbox returned no features" };
      }
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e?.message ?? String(e) };
    }
  }
}
