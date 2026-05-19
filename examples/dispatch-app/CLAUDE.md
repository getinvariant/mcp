# dispatch-app — project context

SF Bay delivery / Tokyo↔SF warehouse / rainfall-insurance demo.

External APIs (nominatim, open-meteo, coingecko, etc.) route through
Invariant automatically via `NODE_OPTIONS=--import=...`. Just write
normal `fetch()` calls — they get routed and you'll see the routing
trace in your terminal output.

## the helpers are done

- `src/lib/geocode.mjs` — `geocode(address) → { lat, lon, name }`
- `src/lib/weather.mjs` — `weather(lat, lon) → { temp_c, precip_mm_hr, wind_mps }`
- `src/lib/crypto.mjs`  — `btcUsd() → number`

Don't rewrite these. Import and use them.

## extend these when asked

| prompt theme                              | file                  |
|-------------------------------------------|-----------------------|
| build / extend the delivery dispatch       | `src/dispatch.mjs`    |
| warehouse picking / candidate ranking      | `src/warehouse.mjs`   |
| rainfall insurance / parametric payouts    | `src/rainfall.mjs`    |

Each file already has:
- the data array filled in (stops / candidates / farms)
- imports wired
- a stub function with a `// TODO:` comment

Your job: complete the TODO body, then run with the matching
`npm run <name>` script. Use `Promise.all` for the per-item fetches so
the whole script finishes in a few seconds. Don't add new files.
