import type { RouteFetchRequest } from "./types.js";

export function parseRequest(url: string, _init?: RequestInit): RouteFetchRequest | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  if (u.hostname === "api.geoapify.com") {
    if (u.pathname === "/v1/geocode/search") {
      const text = u.searchParams.get("text");
      if (!text) return null;
      const params: { text: string; [k: string]: any } = { text };
      for (const [k, v] of u.searchParams.entries()) {
        if (k !== "text" && k !== "apiKey") params[k] = v;
      }
      return { source: "geoapify", task_type: "places:geocode", params };
    }
    return null;
  }

  if (u.hostname === "api.mapbox.com") {
    const m = u.pathname.match(/^\/geocoding\/v5\/mapbox\.places\/(.+)\.json$/);
    if (m) {
      const text = decodeURIComponent(m[1]);
      const params: { text: string; [k: string]: any } = { text };
      for (const [k, v] of u.searchParams.entries()) {
        if (k !== "access_token") params[k] = v;
      }
      return { source: "mapbox", task_type: "places:geocode", params };
    }
    return null;
  }

  return null;
}
