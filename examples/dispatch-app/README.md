# dispatch-app

Sample SF Bay delivery / Tokyo↔SF warehouse / rainfall-insurance app
built on top of Invariant routing.

Every external API call goes through Invariant via the global
`NODE_OPTIONS=--import=~/.invariant/auto.mjs` (installed once via the
curl bootstrap on getinvariant.com/install).

## scripts

- `npm run dispatch`  — weather-aware delivery routing
- `npm run warehouse` — Tokyo ↔ SF warehouse candidate analysis
- `npm run rainfall`  — parametric rainfall insurance payouts

## structure

```
src/
├── lib/
│   ├── geocode.mjs   — nominatim wrapper
│   ├── weather.mjs   — open-meteo wrapper
│   └── crypto.mjs    — coingecko BTC/USD wrapper
├── dispatch.mjs      — delivery dispatch (extend the TODO)
├── warehouse.mjs     — warehouse picker (extend the TODO)
└── rainfall.mjs      — insurance payouts (extend the TODO)
```

All three top-level scripts ship with the data arrays already populated
and a TODO marking the analysis function to complete. The lib helpers
are done — they just wrap fetch with a tiny normalized return shape.
