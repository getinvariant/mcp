import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class OpenMeteoProvider implements Provider {
  info: ProviderInfo = {
    id: "open_meteo",
    name: "Open-Meteo",
    category: ProviderCategory.ENVIRONMENT,
    description:
      "Free weather forecast API. No API key required. Lat/lon based current conditions.",
    availableActions: [
      {
        action: "current_weather",
        description: "Get current weather for a lat/lon",
        parameters: {
          lat: { type: "number", description: "Latitude", required: true },
          lon: { type: "number", description: "Longitude", required: true },
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
    if (action !== "current_weather") {
      return { success: false, error: `unknown action ${action}` };
    }
    const lat = params.lat as number;
    const lon = params.lon as number;
    if (lat == null || lon == null) {
      return { success: false, error: "lat, lon required" };
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&wind_speed_unit=ms`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { success: false, error: `open-meteo error (${res.status})` };
      }
      const data: any = await res.json();
      const c = data?.current ?? {};
      return {
        success: true,
        data: {
          lat: data.latitude,
          lon: data.longitude,
          temperature_c: c.temperature_2m,
          feels_like_c: c.apparent_temperature,
          humidity_pct: c.relative_humidity_2m,
          wind_mps: c.wind_speed_10m,
          weather_code: c.weather_code,
          description: weatherCodeToDescription(c.weather_code),
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

// WMO weather codes — small subset for demo. https://open-meteo.com/en/docs
function weatherCodeToDescription(code: number | undefined): string {
  if (code == null) return "unknown";
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  if (code <= 99) return "thunderstorm";
  return "unknown";
}
