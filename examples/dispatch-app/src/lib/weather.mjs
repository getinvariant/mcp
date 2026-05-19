// Current weather at a lat/lon via Open-Meteo. Invariant intercepts this
// fetch and routes to whichever env:weather provider wins (open-meteo,
// openweather, etc.).

export async function weather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m`;
  const res = await fetch(url);
  const data = await res.json();
  const c = data?.current ?? {};
  return {
    temp_c: c.temperature_2m,
    precip_mm_hr: c.precipitation ?? 0,
    wind_mps: c.wind_speed_10m,
    humidity_pct: c.relative_humidity_2m,
  };
}
