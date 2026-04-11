import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class GoogleMapsProvider implements Provider {
  info: ProviderInfo = {
    id: "google_maps",
    name: "Google Maps",
    category: ProviderCategory.MAPS,
    description:
      "Google Maps Platform — geocoding, place search, and directions.",
    availableActions: [
      {
        action: "geocode",
        description: "Convert an address to coordinates",
        parameters: {
          address: {
            type: "string",
            description: "Address to geocode",
            required: true,
          },
        },
      },
      {
        action: "places_search",
        description: "Search for places by name or type near a location",
        parameters: {
          query: {
            type: "string",
            description: "Search query (e.g., 'coffee shops in Nashville')",
            required: true,
          },
        },
      },
      {
        action: "directions",
        description: "Get directions between two locations",
        parameters: {
          origin: {
            type: "string",
            description: "Starting address or place",
            required: true,
          },
          destination: {
            type: "string",
            description: "Destination address or place",
            required: true,
          },
          mode: {
            type: "string",
            description:
              "Travel mode: driving, walking, bicycling, transit (default: driving)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.GOOGLE_MAPS_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey)
      return { success: false, error: "Google Maps API key not configured" };

    switch (action) {
      case "geocode": {
        const address = params.address as string;
        if (!address)
          return {
            success: false,
            error: "Missing required parameter: address",
          };
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

        try {
          const res = await fetch(url);
          if (!res.ok)
            return {
              success: false,
              error: `Google Maps error (${res.status})`,
            };
          const data = await res.json();
          if (data.status !== "OK")
            return {
              success: false,
              error: `Geocode error: ${data.status} — ${data.error_message || ""}`,
            };
          const r = data.results[0];
          return {
            success: true,
            data: {
              formatted_address: r.formatted_address,
              lat: r.geometry.location.lat,
              lng: r.geometry.location.lng,
              place_id: r.place_id,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }

      case "places_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;

        try {
          const res = await fetch(url);
          if (!res.ok)
            return {
              success: false,
              error: `Google Maps error (${res.status})`,
            };
          const data = await res.json();
          if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            return { success: false, error: `Places error: ${data.status}` };
          }
          return {
            success: true,
            data: data.results?.slice(0, 10).map((r: any) => ({
              name: r.name,
              address: r.formatted_address,
              rating: r.rating,
              place_id: r.place_id,
              lat: r.geometry?.location?.lat,
              lng: r.geometry?.location?.lng,
            })),
          };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }

      case "directions": {
        const origin = params.origin as string;
        const destination = params.destination as string;
        if (!origin || !destination)
          return {
            success: false,
            error: "Missing required parameters: origin, destination",
          };
        const mode = (params.mode as string) || "driving";
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${mode}&key=${apiKey}`;

        try {
          const res = await fetch(url);
          if (!res.ok)
            return {
              success: false,
              error: `Google Maps error (${res.status})`,
            };
          const data = await res.json();
          if (data.status !== "OK")
            return {
              success: false,
              error: `Directions error: ${data.status}`,
            };
          const route = data.routes[0];
          const leg = route?.legs[0];
          return {
            success: true,
            data: {
              summary: route?.summary,
              distance: leg?.distance?.text,
              duration: leg?.duration?.text,
              start_address: leg?.start_address,
              end_address: leg?.end_address,
              steps: leg?.steps?.map((s: any) => ({
                instruction: s.html_instructions?.replace(/<[^>]+>/g, ""),
                distance: s.distance?.text,
                duration: s.duration?.text,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
