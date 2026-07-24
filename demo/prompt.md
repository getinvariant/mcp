Three demo prompts. Each forces the agent across all three task types — `places:geocode`, `env:weather`, and `finance:price:crypto` — so the routing viz lights up with real, non-trivial metrics. Run them in order: 1 → 2 → 3 (simplest to most impressive).

Between each prompt, the routing viz should show three task types learning simultaneously and the success-rate curves stabilizing per provider.

---

## 1 — Crypto-paid delivery dispatch

Pay our drivers in crypto with a weather bonus when conditions get rough. Build a dispatcher that walks our pickup list end to end.

Requirements:
- 8 delivery stops, real addresses in NYC and SF (e.g. "1 World Trade Center, NY", "Ferry Building, San Francisco", "Times Square, NY", "Pier 39, San Francisco", "Empire State Building, NY", "Coit Tower, San Francisco", "Brooklyn Bridge Park, NY", "Golden Gate Park, San Francisco")
- For every stop, call the Invariant `route` tool three times: once with task_type "places:geocode" to get lat/lon, once with "env:weather" for current conditions, once with "finance:price:crypto" for the live BTC/USD rate
- Compute the payout per stop: base $4, +$1 if rain, +$2 if temp < 5°C or > 35°C, then quote it in BTC using the live rate
- Save the result to `dispatch.json` as a list of `{stop, lat, lon, weather, payout_usd, payout_btc}`
- Print a short table to the terminal so I can read it as it runs

Process all 8 stops before showing me the final manifest.

---

## 2 — Tokyo ↔ SF warehouse picker

We're shortlisting micro-warehouses in Tokyo and SF. For each candidate, find it on the map, check the climate, and price the rent in BTC. Flag any spot where heating or cooling is going to be expensive.

Requirements:
- 10 candidate addresses, 5 in Tokyo and 5 in San Francisco (e.g. "Shibuya Crossing, Tokyo", "Shinjuku Station, Tokyo", "Tokyo Tower", "Akihabara, Tokyo", "Ginza, Tokyo", "SoMa, San Francisco", "Mission District, San Francisco", "Dogpatch, San Francisco", "Bayview, San Francisco", "Potrero Hill, San Francisco")
- For each: call `route` with "places:geocode", then "env:weather", then "finance:price:crypto" for BTC/USD
- Convert a mocked monthly rent of $4,200 (SF) or ¥520,000 (Tokyo) into BTC using the live rate
- Flag any address where temp is > 30°C or < 5°C with humidity > 60% (HVAC red flag)
- Rank by `score = -hvac_flag * 2 + (rent_btc < median ? 1 : 0)` and write `warehouses.json` ranked best to worst
- Print the top 3 and bottom 3 with the flag reason

Geocode + weather + BTC quote all 10 before ranking.

---

## 3 — Rainfall insurance payout

We sell rainfall insurance to farmers in the central valley. When it rains too much, we pay out. Draft a settlement script.

Requirements:
- 6 farm locations across California's central valley (e.g. "Fresno, CA", "Bakersfield, CA", "Modesto, CA", "Stockton, CA", "Visalia, CA", "Merced, CA")
- For each farm, call `route` with "places:geocode", then "env:weather" to read today's rainfall (mm), then "finance:price:crypto" for the current BTC/USD rate
- Payout rule: 0.0001 BTC per mm of rainfall above 10mm/day, otherwise zero
- Compute USD equivalent using the live BTC rate
- Mock the on-chain settlement — log every payout to `settlements.json` as `{farm, lat, lon, rainfall_mm, payout_btc, payout_usd, tx_hash}` where tx_hash is a random hex string
- Print a one-line settlement summary per farm and a total at the bottom

Process all 6 farms end to end before reporting the total.
