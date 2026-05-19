# dispatch-app

Sample app for the Invariant demo. Two scenarios:

- `npm run dispatch`  — Bay Area weather-aware delivery routing
- `npm run warehouse` — Tokyo ↔ SF warehouse candidate analysis (climate + BTC rent)

Every external API call goes through Invariant via the global
`NODE_OPTIONS=--import=~/.invariant/auto.mjs` (installed once via the
curl bootstrap on getinvariant.com/install).

## structure

```
src/
├── lib/
│   ├── geocode.mjs   — nominatim wrapper
│   ├── weather.mjs   — open-meteo wrapper
│   └── crypto.mjs    — coingecko BTC/USD wrapper
├── dispatch.mjs      — weather-aware dispatch (extend the TODO)
└── warehouse.mjs     — warehouse picker (extend the TODO)
```

The lib helpers are done. The two top-level scripts have a TODO
analysis function — the agent fills in the data and the body, then
runs the matching `npm` script.
