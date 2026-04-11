import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class EnvironmentProvider implements Provider {
  info: ProviderInfo = {
    id: "environment",
    name: "OpenWeatherMap",
    category: ProviderCategory.ENVIRONMENT,
    description:
      "Current weather conditions and air quality data for any location worldwide.",
    availableActions: [
      {
        action: "current_weather",
        description: "Get current weather for a city",
        parameters: {
          city: {
            type: "string",
            description: "City name (e.g., 'Nashville', 'London,UK')",
            required: true,
          },
          units: {
            type: "string",
            description:
              "Units: metric, imperial, or standard (default metric)",
            required: false,
          },
        },
      },
      {
        action: "air_quality",
        description: "Get air quality index and pollutant data for coordinates",
        parameters: {
          lat: { type: "number", description: "Latitude", required: true },
          lon: { type: "number", description: "Longitude", required: true },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.OPENWEATHER_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey)
      return { success: false, error: "OpenWeatherMap API key not configured" };

    const base = "https://api.openweathermap.org/data/2.5";

    switch (action) {
      case "current_weather": {
        const city = params.city as string;
        if (!city)
          return { success: false, error: "Missing required parameter: city" };
        const units = (params.units as string) || "metric";
        const url = `${base}/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}`;
        try {
          const res = await fetch(url);
          if (!res.ok) {
            const text = await res.text();
            return {
              success: false,
              error: `OpenWeatherMap error (${res.status}): ${text}`,
            };
          }
          const data = await res.json();
          return {
            success: true,
            data: {
              location: data.name,
              country: data.sys?.country,
              temperature: data.main?.temp,
              feels_like: data.main?.feels_like,
              humidity: data.main?.humidity,
              description: data.weather?.[0]?.description,
              wind_speed: data.wind?.speed,
              units,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }
      case "air_quality": {
        const lat = params.lat as number;
        const lon = params.lon as number;
        if (lat == null || lon == null)
          return {
            success: false,
            error: "Missing required parameters: lat, lon",
          };
        const url = `${base}/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
        try {
          const res = await fetch(url);
          if (!res.ok)
            return {
              success: false,
              error: `OpenWeatherMap error (${res.status})`,
            };
          const data = await res.json();
          const item = data.list?.[0];
          return {
            success: true,
            data: {
              aqi: item?.main?.aqi,
              aqi_label:
                ["", "Good", "Fair", "Moderate", "Poor", "Very Poor"][
                  item?.main?.aqi
                ] || "Unknown",
              components: item?.components,
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
