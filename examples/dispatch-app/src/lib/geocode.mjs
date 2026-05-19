// Geocode an address via Nominatim. Invariant intercepts this fetch and
// routes to whichever places:geocode provider wins for the region.

export async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "dispatch-app/0.1" },
  });
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`no geocode result for "${address}"`);
  }
  const top = data[0];
  return {
    lat: parseFloat(top.lat),
    lon: parseFloat(top.lon),
    name: top.display_name,
  };
}
