// Smoke-test: hits places + weather + crypto under one PL key.
// Assumes the one-click install has been run (env vars + NODE_OPTIONS loaded).
//
//   node ~/test.mjs

async function geocode(addr) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`,
    { headers: { "User-Agent": "invariant-demo/0.1" } },
  );
  const d = await r.json();
  return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
}

async function weather(lat, lon) {
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation`,
  );
  return r.json();
}

async function btc() {
  const r = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  );
  return (await r.json()).bitcoin.usd;
}

console.log(`\n  btc: $${await btc()}\n`);

const stops = [
  "Ferry Building, San Francisco",
  "Pier 39, San Francisco",
];

for (const s of stops) {
  const g = await geocode(s);
  const w = await weather(g.lat, g.lon);
  console.log(`  ${s}`);
  console.log(`    ${g.lat.toFixed(4)}, ${g.lon.toFixed(4)} · ${w.current.temperature_2m}°C\n`);
}
