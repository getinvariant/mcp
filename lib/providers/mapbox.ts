import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

// Mapbox's official env var is MAPBOX_ACCESS_TOKEN; keep MAPBOX_API_KEY as a
// fallback so older deploys that set it still work.
function mapboxKey(): string | undefined {
  return process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_API_KEY;
}

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
    return !!mapboxKey();
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    // Demo chaos: when DEMO_FAIL_RATE is set on Railway (any positive
    // value), this provider fails its hardcoded share of calls. Master
    // switch is the same env var the other chaos-enabled providers use.
    if (
      parseFloat(process.env.DEMO_FAIL_RATE || "0") > 0 &&
      Math.random() < 0.4
    ) {
      return { success: false, error: "simulated provider outage" };
    }

    if (action !== "geocode") {
      return { success: false, error: `mapbox: unknown action ${action}` };
    }
    const key = mapboxKey();
    if (!key) return { success: false, error: "MAPBOX_ACCESS_TOKEN not set" };
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
