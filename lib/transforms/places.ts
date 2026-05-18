// Places response transforms.
// Each provider's `query()` already returns a (mostly) normalized shape, but
// the agent who called `fetch("api.geoapify.com/...")` expects geoapify-native
// GeoJSON back, not the internal flat list. So we go:
//
//   provider body  ->  internal normalized list  ->  source's native shape
//
// `chosen` is the provider that actually ran. `source` is the host the agent
// originally typed. If they differ, the routing was invisible — and the agent
// still sees a response matching the host they hit.

type NormalizedPlace = {
  display_name: string;
  lat: number;
  lon: number;
  country?: string;
  state?: string;
  city?: string;
};

function findContextText(
  context: any[] | undefined,
  prefix: string,
): string | undefined {
  if (!Array.isArray(context)) return undefined;
  const hit = context.find(
    (c) => typeof c?.id === "string" && c.id.startsWith(prefix),
  );
  return hit?.text;
}

function toNum(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  return NaN;
}

export function normalizePlaces(
  body: any,
  provider: string,
): NormalizedPlace[] {
  if (provider === "geoapify" || provider === "openstreetmap") {
    if (!Array.isArray(body)) return [];
    return body.map((r: any) => ({
      display_name: r.display_name,
      lat: toNum(r.lat),
      lon: toNum(r.lon),
      country: r.country ?? r.address?.country,
      state: r.state ?? r.address?.state,
      city: r.city ?? r.address?.city ?? r.address?.town,
    }));
  }
  if (provider === "mapbox") {
    const features = Array.isArray(body?.features) ? body.features : [];
    return features.map((f: any) => {
      const center = Array.isArray(f?.center) ? f.center : [];
      return {
        display_name: f?.place_name,
        lat: toNum(center[1]),
        lon: toNum(center[0]),
        country: findContextText(f?.context, "country."),
        state: findContextText(f?.context, "region."),
        city: findContextText(f?.context, "place.") ?? f?.text,
      };
    });
  }
  return [];
}

export function toSourceShape(places: NormalizedPlace[], source: string): any {
  if (source === "nominatim") {
    return places.map((p) => ({
      display_name: p.display_name,
      lat: String(p.lat),
      lon: String(p.lon),
      type: "place",
      address: {
        country: p.country,
        state: p.state,
        city: p.city,
      },
    }));
  }
  if (source === "geoapify") {
    return {
      type: "FeatureCollection",
      features: places.map((p) => ({
        type: "Feature",
        properties: {
          formatted: p.display_name,
          lat: p.lat,
          lon: p.lon,
          country: p.country,
          state: p.state,
          city: p.city,
        },
        geometry: {
          type: "Point",
          coordinates: [p.lon, p.lat],
        },
      })),
    };
  }
  if (source === "mapbox") {
    return {
      type: "FeatureCollection",
      features: places.map((p) => ({
        type: "Feature",
        place_name: p.display_name,
        center: [p.lon, p.lat],
        geometry: {
          type: "Point",
          coordinates: [p.lon, p.lat],
        },
        context: [
          p.country ? { id: "country.x", text: p.country } : null,
          p.state ? { id: "region.x", text: p.state } : null,
          p.city ? { id: "place.x", text: p.city } : null,
        ].filter(Boolean),
      })),
    };
  }
  return places;
}

export function transformPlacesResponse(
  body: any,
  chosen: string,
  source: string,
): any {
  return toSourceShape(normalizePlaces(body, chosen), source);
}
