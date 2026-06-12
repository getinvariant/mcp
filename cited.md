# cited.md — Invariant API Credit Bureau

> The public credit report for paid APIs. Invariant fronts the vendor key, pays
> per call with real money, and scores each provider on **value delivered per
> dollar** from real transaction history. The highest-creditworthiness provider
> gets our money; when a paid API underdelivers, its score drops and we reroute
> to the rival. Scores are a rolling query over the ClickHouse ledger — not app
> memory. Accuracy is judged by an LLM served on Pioneer; the agent→Invariant
> leg settles in real Base Sepolia USDC via x402.

_Generated 2026-06-12T23:13:01.088Z from the live ledger._

---
### Category: `maps`

| Rank | Provider | Grade | Creditworthiness | Real $ spent | Calls | Success | Accuracy | $/call |
|-----:|----------|:-----:|-----------------:|-------------:|------:|--------:|---------:|-------:|
| 1 | **mapbox** | A | 500 | $0.00300 | 4 | 75% | 50% | $0.00075 |
| 2 | google_maps | D | 198 | $0.03000 | 6 | 100% | 99% | $0.00500 |

**Money routes to `mapbox`** — best value delivered per dollar (accuracy 50% × success 75% ÷ $0.00075/call = 500).

<details><summary>Delivery evidence (recent calls)</summary>

| ts | provider | success | accuracy | $ cost | latency | x402 settlement |
|----|----------|:-------:|---------:|-------:|--------:|-----------------|
| 2026-06-12 22:44:39 | google_maps | ✓ | 1.00 | $0.00500 | 128ms | [`0xcad0f390…`](https://sepolia.basescan.org/tx/0xcad0f3901d77466a042f22c6ed8126aa65e4aebe35df35a275d90b2c08eec661) |
| 2026-06-12 22:42:14 | google_maps | ✓ | 1.00 | $0.00500 | 229ms | [`0xe84ad45a…`](https://sepolia.basescan.org/tx/0xe84ad45a019f61650399a1225085b3e255859938a0456806d9fac921ad3e96eb) |
| 2026-06-12 22:29:07 | mapbox | ✓ | 0.55 | $0.00075 | 244ms | — |
| 2026-06-12 22:29:05 | google_maps | ✓ | 1.00 | $0.00500 | 182ms | — |
| 2026-06-12 22:29:04 | google_maps | ✓ | 1.00 | $0.00500 | 372ms | — |
| 2026-06-12 22:29:03 | mapbox | ✓ | 0.55 | $0.00075 | 233ms | — |
| 2026-06-12 22:08:54 | mapbox | ✗ | 0.00 | $0.00075 | 90ms | — |
| 2026-06-12 22:08:54 | mapbox | ✓ | 0.90 | $0.00075 | 110ms | — |

</details>

---

**How the score works:** `creditworthiness = avg(accuracy) × success_rate ÷ avg(cost_usd)`.
It is financial, not uptime: a provider that is cheap but wrong, or accurate but
expensive, loses to the rival that delivers more correct answers per dollar.
