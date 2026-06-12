# cited.md — Invariant API Credit Bureau

> The public credit report for paid APIs. Invariant fronts the vendor key, pays
> per call with real money, and scores each provider on **value delivered per
> dollar** from real transaction history. The highest-creditworthiness provider
> gets our money; when a paid API underdelivers, its score drops and we reroute
> to the rival. Scores are a rolling query over the ClickHouse ledger — not app
> memory. Accuracy is judged by an LLM served on Pioneer; the agent→Invariant
> leg settles in real Base Sepolia USDC via x402.

_Generated 2026-06-12T23:16:41.916Z from the live ledger._

---
### Category: `maps`

| Rank | Provider | Grade | Creditworthiness | Real $ spent | Calls | Success | Accuracy | $/call |
|-----:|----------|:-----:|-----------------:|-------------:|------:|--------:|---------:|-------:|
| 1 | **google_maps** | A | 195 | $0.04500 | 9 | 100% | 98% | $0.00500 |
| 2 | mapbox | B | 163 | $0.00525 | 7 | 43% | 29% | $0.00075 |

**Money routes to `google_maps`** — best value delivered per dollar (accuracy 98% × success 100% ÷ $0.00500/call = 195).

<details><summary>Delivery evidence (recent calls)</summary>

| ts | provider | success | accuracy | $ cost | latency | x402 settlement |
|----|----------|:-------:|---------:|-------:|--------:|-----------------|
| 2026-06-12 23:16:41 | google_maps | ✓ | 0.95 | $0.00500 | 75ms | — |
| 2026-06-12 23:16:40 | mapbox | ✗ | 0.00 | $0.00075 | 0ms | — |
| 2026-06-12 23:16:40 | google_maps | ✓ | 0.95 | $0.00500 | 79ms | — |
| 2026-06-12 23:16:38 | mapbox | ✗ | 0.00 | $0.00075 | 0ms | — |
| 2026-06-12 23:16:38 | google_maps | ✓ | 0.95 | $0.00500 | 221ms | — |
| 2026-06-12 23:16:37 | mapbox | ✗ | 0.00 | $0.00075 | 0ms | — |
| 2026-06-12 22:44:39 | google_maps | ✓ | 1.00 | $0.00500 | 128ms | [`0xcad0f390…`](https://sepolia.basescan.org/tx/0xcad0f3901d77466a042f22c6ed8126aa65e4aebe35df35a275d90b2c08eec661) |
| 2026-06-12 22:42:14 | google_maps | ✓ | 1.00 | $0.00500 | 229ms | [`0xe84ad45a…`](https://sepolia.basescan.org/tx/0xe84ad45a019f61650399a1225085b3e255859938a0456806d9fac921ad3e96eb) |

</details>

---

**How the score works:** `creditworthiness = avg(accuracy) × success_rate ÷ avg(cost_usd)`.
It is financial, not uptime: a provider that is cheap but wrong, or accurate but
expensive, loses to the rival that delivers more correct answers per dollar.
