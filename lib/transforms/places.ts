// Places response transforms — map between mapbox-shape and geoapify-shape
// responses so the SDK can transparently swap providers behind a source-pinned
// fetch interception.

export function transformPlacesResponse(
  body: any,
  from: string,
  to: string,
): any {
  if (from === to) return body;
  if (from === "mapbox" && to === "geoapify") return mapboxToGeoapify(body);
  if (from === "geoapify" && to === "mapbox") return geoapifyToMapbox(body);
  return body;
}

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

function mapboxToGeoapify(body: any): any {
  const features = Array.isArray(body?.features) ? body.features : [];
  return {
    features: features.map((f: any) => {
      const center = Array.isArray(f?.center) ? f.center : [];
      const country = findContextText(f?.context, "country.");
      const state = findContextText(f?.context, "region.");
      const city = findContextText(f?.context, "place.") ?? f?.text;
      const properties: Record<string, any> = {
        formatted: f?.place_name,
        lon: center[0],
        lat: center[1],
      };
      if (country !== undefined) properties.country = country;
      if (state !== undefined) properties.state = state;
      if (city !== undefined) properties.city = city;
      return { properties };
    }),
  };
}

function geoapifyToMapbox(body: any): any {
  const features = Array.isArray(body?.features) ? body.features : [];
  return {
    features: features.map((f: any) => {
      const p = f?.properties ?? {};
      const context: { id: string; text: string }[] = [];
      if (p.country !== undefined)
        context.push({ id: "country.x", text: p.country });
      if (p.state !== undefined)
        context.push({ id: "region.x", text: p.state });
      if (p.city !== undefined)
        context.push({ id: "place.x", text: p.city });
      return {
        place_name: p.formatted,
        center: [p.lon, p.lat],
        context,
      };
    }),
  };
}
