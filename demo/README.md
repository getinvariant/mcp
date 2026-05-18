# Invariant Demo Script — YC

Total time: ~8 minutes

---

## Before you start

1. Open the viz dashboard in a browser tab: `https://getinvariant.com/viz`
2. Make sure Invariant MCP is installed in Claude (`claude mcp list` should show `invariant`)
3. Have Railway dashboard open in another tab (you'll need it for step 3)
4. Keep this file open on your phone or a second screen

---

## Step 1 — Set the scene (30 seconds, no typing)

Say:

> "Most agents today call APIs directly. If a provider is slow, expensive, or down — the agent fails or you pay for it. Invariant sits between the agent and the APIs. One key, all providers, and it learns which one to use."

Then open a new Claude terminal session.

---

## Step 2 — Paste the prompt (1 minute)

Paste the contents of `prompt.md` into Claude.

While Claude works, narrate:

> "Claude is calling the `route` tool for each asset. Invariant is picking the best provider based on what it's learned so far — cold start means 50/50 between CoinGecko and Finnhub."

Point at the viz:

> "Watch panel 01 — every call shows up in real time. Panel 02 is the learning curve. Right now it's flat because both providers look equal. That's about to change."

---

## Step 3 — Break Finnhub (30 seconds)

While the dashboard is auto-refreshing (every 30s), go to Railway:

**Railway → routing-one-click → Variables → FINNHUB_API_KEY → delete the value (set to empty string) → Save → wait ~10 seconds for redeploy**

Then say:

> "Finnhub just went down. Maybe their API key expired, maybe they're having an outage — happens all the time in production."

---

## Step 4 — Watch the system learn (2 minutes)

Let 2-3 refresh cycles run (60-90 seconds). Point at the viz as it updates:

- **Panel 01** — Finnhub calls start appearing with ✗ (failure)
- **Panel 02** — Finnhub's line drops, CoinGecko's holds at 1.0
- **Panel 03** — "Failures avoided" counter starts climbing
- **Panel 04** — Raw events show the routing decisions shifting

Say:

> "The system observed Finnhub failing and is routing away from it automatically. The agent didn't change a single line of code. The dashboard is still returning prices — it just switched providers."

> "That failures avoided number? That's every call that would have errored if the agent was hitting Finnhub directly."

---

## Step 5 — Restore Finnhub (30 seconds)

Go back to Railway, restore the Finnhub key, save.

Say:

> "Now Finnhub comes back online. Watch what happens."

After 1-2 refresh cycles:

> "The system starts re-weighting Finnhub as it sees successful calls again. It doesn't need a human to update a config file or flip a feature flag — it just learns."

---

## Step 6 — Close (1 minute)

Point at the learning curve:

> "Every agent that uses Invariant makes the routing smarter — not just for them, but across accounts as we aggregate signal. This is the data flywheel. The more it's used, the better it gets."

> "One API key. Drop-in for any agent. Works with Claude, Cursor, any MCP-compatible client."

---

## Backup — if something breaks

- Rate limited? Wait 60 seconds and retry. Tell the audience: "Free tier has a 60 req/min cap — the paid tier removes this."
- Viz not updating? Hard refresh the viz tab.
- Claude not using `route` tool? Say "use the invariant route tool for each symbol" explicitly.
- Railway not redeploying fast enough? The viz will show the moment it kicks in — you can narrate the lag as "propagation delay in the config change, would be instant with their own key."
