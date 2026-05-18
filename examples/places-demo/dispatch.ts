// Pretend this was written by a coding agent that doesn't know Invariant exists.
// It reaches for Nominatim because it's free and needs no key. The user holds
// only INVARIANT_PL_KEY — no Geoapify/Mapbox keys anywhere.
import "dotenv/config";
import { installInvariant } from "../../packages/sdk/src/index.js";
import { writeFileSync } from "node:fs";

const PL_KEY = process.env.INVARIANT_PL_KEY ?? process.env.PL_API_KEY;
if (!PL_KEY) {
  console.error("set INVARIANT_PL_KEY in your .env first");
  process.exit(1);
}

installInvariant({
  pl_key: PL_KEY,
  base_url: process.env.INVARIANT_BASE_URL ?? "https://getinvariant.com",
});

const stops = [
  "Ferry Building, San Francisco, CA",
  "Mission Dolores, San Francisco, CA",
  "Lake Merritt, Oakland, CA",
  "Telegraph Ave, Berkeley, CA",
  "Pier 39, San Francisco, CA",
  "Jack London Square, Oakland, CA",
  "UC Berkeley, Berkeley, CA",
  "Golden Gate Park, San Francisco, CA",
];

// What an agent writes when it Googles "free geocoding api".
async function geocodeStop(address: string): Promise<{ lat: number; lon: number; name: string }> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "dispatch/0.1" } });
  const body = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  const top = body[0];
  return {
    name: top?.display_name ?? address,
    lat: parseFloat(top?.lat ?? "NaN"),
    lon: parseFloat(top?.lon ?? "NaN"),
  };
}

(async () => {
  console.log("\n  SF Bay dispatch — geocoding 8 stops (agent code, naive nominatim)\n");
  const out: { name: string; lat: number; lon: number; provider: string }[] = [];
  for (const addr of stops) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "dispatch/0.1" } });
    const routed = res.headers.get("x-invariant-routed-to") ?? "(direct)";
    const body: any = await res.json();
    const top = Array.isArray(body) ? body[0] : null;
    const lat = parseFloat(top?.lat ?? "NaN");
    const lon = parseFloat(top?.lon ?? "NaN");
    out.push({ name: addr, lat, lon, provider: routed });
    const ok = Number.isFinite(lat) ? "ok  " : "FAIL";
    console.log(`  ${ok}  ${addr.padEnd(40)} → ${routed.padEnd(14)}  ${Number.isFinite(lat) ? lat.toFixed(4) : "—"}, ${Number.isFinite(lon) ? lon.toFixed(4) : "—"}`);
  }
  writeFileSync(
    new URL("./dispatch-stops.json", import.meta.url),
    JSON.stringify(out, null, 2),
  );
  console.log(`\n  wrote ${out.length} stops → examples/places-demo/dispatch-stops.json`);
  console.log("  agent had zero api keys. only the PL key was needed.\n");
})();
