import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";
import { keyPool, withKeyRetry } from "../key-pool.js";

const ENV = "GEOAPIFY_API_KEY";

export class GeoapifyProvider implements Provider {
  info: ProviderInfo = {
    id: "geoapify",
    name: "Geoapify",
    category: ProviderCategory.MAPS,
    description:
      "Geocoding, reverse geocoding, and routing. 3,000 requests/day free, no credit card required.",
    availableActions: [
      {
        action: "geocode",
        description: "Convert an address or place name to coordinates",
        parameters: {
          query: {
            type: "string",
            description: "Address or place name to geocode",
            required: true,
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
            required: false,
          },
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
      {
        action: "route",
        description: "Get routing directions between two coordinates",
        parameters: {
          from_lat: {
            type: "number",
            description: "Origin latitude",
            required: true,
          },
          from_lon: {
            type: "number",
            description: "Origin longitude",
            required: true,
          },
          to_lat: {
            type: "number",
            description: "Destination latitude",
            required: true,
          },
          to_lon: {
            type: "number",
            description: "Destination longitude",
            required: true,
          },
          mode: {
            type: "string",
            description:
              "Travel mode: drive, walk, bicycle, transit (default: drive)",
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
    if (!keyPool.hasKeys(ENV))
      return { success: false, error: "Geoapify API key not configured" };

    const base = "https://api.geoapify.com/v1";

    try {
      switch (action) {
        case "geocode": {
          const query = params.query as string;
          if (!query)
            return {
              success: false,
              error: "Missing required parameter: query",
            };
          const limit = (params.limit as number) || 5;
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/geocode/search?text=${encodeURIComponent(query)}&limit=${limit}&apiKey=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Geoapify error (${res.status})` };
          const data = await res.json();
          return {
            success: true,
            data: data.features?.map((f: any) => ({
              display_name: f.properties.formatted,
              lat: f.properties.lat,
              lon: f.properties.lon,
              country: f.properties.country,
              city: f.properties.city,
              state: f.properties.state,
            })),
          };
        }

        case "reverse_geocode": {
          const lat = params.lat as number;
          const lon = params.lon as number;
          if (lat == null || lon == null)
            return {
              success: false,
              error: "Missing required parameters: lat, lon",
            };
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Geoapify error (${res.status})` };
          const data = await res.json();
          const props = data.features?.[0]?.properties;
          return {
            success: true,
            data: {
              display_name: props?.formatted,
              country: props?.country,
              state: props?.state,
              city: props?.city,
              street: props?.street,
              postcode: props?.postcode,
            },
          };
        }

        case "route": {
          const from_lat = params.from_lat as number;
          const from_lon = params.from_lon as number;
          const to_lat = params.to_lat as number;
          const to_lon = params.to_lon as number;
          if (
            from_lat == null ||
            from_lon == null ||
            to_lat == null ||
            to_lon == null
          ) {
            return {
              success: false,
              error:
                "Missing required parameters: from_lat, from_lon, to_lat, to_lon",
            };
          }
          const mode = (params.mode as string) || "drive";
          const waypoints = `${from_lon},${from_lat}|${to_lon},${to_lat}`;
          const { response: res } = await withKeyRetry(ENV, (apiKey) =>
            fetch(
              `${base}/routing?waypoints=${encodeURIComponent(waypoints)}&mode=${mode}&apiKey=${apiKey}`,
            ),
          );
          if (!res.ok)
            return { success: false, error: `Geoapify error (${res.status})` };
          const data = await res.json();
          const props = data.features?.[0]?.properties;
          return {
            success: true,
            data: {
              distance_meters: props?.distance,
              distance_km: props?.distance
                ? (props.distance / 1000).toFixed(2) + " km"
                : null,
              duration_seconds: props?.time,
              duration_readable: props?.time
                ? formatDuration(props.time)
                : null,
              mode,
            },
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
