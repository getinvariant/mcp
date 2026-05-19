# dispatch-app

Two small scenarios from our Bay Area logistics work:

- `npm run dispatch`  — weather-aware delivery routing across SF / Oakland / Berkeley
- `npm run warehouse` — Tokyo ↔ SF warehouse candidate analysis (climate + BTC-priced rent)

Every external API call goes through Invariant (geocoding, weather, BTC pricing
all route through the global `NODE_OPTIONS=--import=~/.invariant/auto.mjs`
that the curl bootstrap on getinvariant.com/install sets up). Calls
look like ordinary `fetch()` — no SDK imports in the app code.

## structure

```
src/
├── lib/
│   ├── geocode.mjs   — geocode(address) → { lat, lon, name }     (nominatim)
│   ├── weather.mjs   — weather(lat, lon) → { temp_c, precip_mm_hr, ... }   (open-meteo)
│   └── crypto.mjs    — btcUsd() → number                          (coingecko)
├── dispatch.mjs      — delivery dispatch (TODO body)
└── warehouse.mjs     — warehouse picker (TODO body)
```

The `lib/` helpers are done. Each top-level script has a `main()` function
with a `TODO:` comment describing the scenario — fill in the body and run
with the matching `npm` script. Use `Promise.all` for the per-item fetches
so the whole script finishes in a few seconds.
