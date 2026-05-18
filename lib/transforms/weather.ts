// Weather transforms — normalized between providers, then reshaped into the
// source's native API shape. Two providers, two source hosts.

type NormalizedWeather = {
  lat?: number;
  lon?: number;
  location_name?: string;
  country?: string;
  temperature_c?: number;
  feels_like_c?: number;
  humidity_pct?: number;
  wind_mps?: number;
  description?: string;
  weather_code?: number;
};

function normalize(body: any, provider: string): NormalizedWeather {
  if (provider === "environment") {
    // EnvironmentProvider's pre-normalized output.
    return {
      location_name: body?.location,
      country: body?.country,
      temperature_c: body?.temperature,
      feels_like_c: body?.feels_like,
      humidity_pct: body?.humidity,
      wind_mps: body?.wind_speed,
      description: body?.description,
    };
  }
  if (provider === "open_meteo") {
    return {
      lat: body?.lat,
      lon: body?.lon,
      temperature_c: body?.temperature_c,
      feels_like_c: body?.feels_like_c,
      humidity_pct: body?.humidity_pct,
      wind_mps: body?.wind_mps,
      description: body?.description,
      weather_code: body?.weather_code,
    };
  }
  return {};
}

function toSourceShape(n: NormalizedWeather, source: string): any {
  if (source === "openweather") {
    return {
      coord: { lat: n.lat ?? 0, lon: n.lon ?? 0 },
      weather: [{ description: n.description, main: n.description }],
      main: {
        temp: n.temperature_c,
        feels_like: n.feels_like_c,
        humidity: n.humidity_pct,
      },
      wind: { speed: n.wind_mps },
      sys: { country: n.country },
      name: n.location_name,
      dt: Math.floor(Date.now() / 1000),
    };
  }
  if (source === "openmeteo") {
    return {
      latitude: n.lat,
      longitude: n.lon,
      current: {
        temperature_2m: n.temperature_c,
        apparent_temperature: n.feels_like_c,
        relative_humidity_2m: n.humidity_pct,
        wind_speed_10m: n.wind_mps,
        weather_code: n.weather_code ?? 0,
      },
      current_units: {
        temperature_2m: "°C",
        relative_humidity_2m: "%",
        wind_speed_10m: "m/s",
      },
    };
  }
  return n;
}

export function transformWeather(
  body: any,
  chosen: string,
  source: string,
): any {
  return toSourceShape(normalize(body, chosen), source);
}
