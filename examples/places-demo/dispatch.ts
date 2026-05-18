// Pretend a coding agent wrote this. It reaches for Nominatim because it's
// free and needs no key. The user holds only INVARIANT_PL_KEY — no provider
// keys anywhere. The SDK's verbose mode narrates each interception.
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
  verbose: true,
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

async function geocodeStop(
  address: string,
): Promise<{ name: string; lat: number; lon: number }> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "dispatch/0.1" } });
  const body = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
  }>;
  const top = body[0];
  return {
    name: top?.display_name ?? address,
    lat: parseFloat(top?.lat ?? "NaN"),
    lon: parseFloat(top?.lon ?? "NaN"),
  };
}

(async () => {
  console.log("\n  sf bay dispatch · geocoding 8 stops\n");
  const out: { name: string; lat: number; lon: number }[] = [];
  for (const addr of stops) {
    const stop = await geocodeStop(addr);
    out.push(stop);
  }
  writeFileSync(
    new URL("./dispatch-stops.json", import.meta.url),
    JSON.stringify(out, null, 2),
  );
  console.log(`\n  wrote ${out.length} stops → dispatch-stops.json`);
})();
