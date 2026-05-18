# Invariant — places demo

The YC moment: a coding agent writes `fetch("api.geoapify.com/...")`. Invariant routes it under the hood.

## Run

1. Start the backend in one terminal:
   ```bash
   npx tsx dev-server.ts
   ```

2. In another terminal:
   ```bash
   export INVARIANT_PL_KEY=pl_yourkeyhere
   npx tsx examples/places-demo/run-demo.ts
   ```

You'll see per-address routing decisions:

```
  ok    Embarcadero, San Francisco        → geoapify  [us-west   ]  #1
        resolved: 1 Ferry Building, San Francisco, CA, USA
  ok    Shibuya, Tokyo                    → mapbox    [asia-east ]  #2
        resolved: Shibuya, Tokyo, Japan
  ...
```

## What's actually happening

`run-demo.ts` calls `installInvariant({...})` once. That patches global `fetch`.

`agent-code.ts` — which simulates code an agent would write — uses plain `fetch("api.geoapify.com/...")`. The agent has no idea Invariant exists.

The patched fetch detects the geoapify hostname, posts to `POST localhost:3000/api/route-fetch`, the backend runs the routing math (per-account, per-region), calls whichever provider wins for that query's region, transforms the response back to geoapify shape, and returns. The agent's code sees a normal geoapify response.

The routing is BELOW the fetch layer. There's no tool to bypass.

## Why this matters

Most "routing layer" products require the agent to learn a new API. The agent can ignore them.
Invariant routes at the network boundary. The agent's code stays the same. The routing is undeniable.
