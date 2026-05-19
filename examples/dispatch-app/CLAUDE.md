# dispatch-app — project context

SF Bay delivery dispatch + Tokyo↔SF warehouse picker.

External APIs (nominatim, open-meteo, coingecko) route through Invariant
automatically via `NODE_OPTIONS=--import=...auto.mjs` (installed
globally). Just write normal `fetch()` calls — they get routed and the
routing trace shows up in the terminal output.

## the helpers are done — import, don't rewrite

- `src/lib/geocode.mjs` — `geocode(address) → { lat, lon, name }`
- `src/lib/weather.mjs` — `weather(lat, lon) → { temp_c, precip_mm_hr, wind_mps, humidity_pct }`
- `src/lib/crypto.mjs`  — `btcUsd() → number`

## extend these when asked

| prompt theme                                  | file                |
|-----------------------------------------------|---------------------|
| build / extend a Bay Area delivery dispatch    | `src/dispatch.mjs`  |
| warehouse picker / Tokyo↔SF candidates         | `src/warehouse.mjs` |

Each file has the analysis function shell with a TODO. Your job:
complete the TODO body (including any data the prompt asks you to
choose / invent), then run with the matching `npm run <name>` script.

- Use `Promise.all` for the per-item fetches so the whole run finishes
  in a few seconds.
- Don't rewrite the helpers.
- Don't add new files.
