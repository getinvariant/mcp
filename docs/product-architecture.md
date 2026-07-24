# Product architecture: pay-on-our-site → routed multi-account API access

> Scope: the *actual product* — users pay you, you allocate their spend across paid
> APIs, and you spread traffic over multiple accounts per provider so no single
> upstream account gets rate-limited or flagged. This deliberately ignores the
> hackathon credit-bureau / x402 layer, which is a demo narrative on top of the
> primitives below.

## The request, end to end (what already exists)

```
agent / user
   │  POST /api/query  (x-pl-key)            [api/query.ts]
   ▼
1. AUTH            lib/auth.ts            resolve x-pl-key → account
   ▼
2. QUOTA + RATE    lib/quota.ts          per-minute token bucket + monthly cap
   ▼
3. ALLOCATE        lib/routing/router.ts pick the provider for the task type
   PROVIDER        (api/route.ts)         from success-rate/latency history
   ▼
4. BILLING GATE    lib/billing.ts        accrueCharge() debits user balance,
                                          refuses to serve if no card / cap hit
   ▼
5. MULTI-ACCOUNT   lib/key-pool.ts       withKeyRetry() picks a non-cooled key
   FAN-OUT         (inside provider)      from the comma-separated pool, 429 →
                                          backoff that key → reroute to next
   ▼
6. UPSTREAM CALL   lib/providers/*.ts    real vendor request
   ▼
7. TRUE-UP + LOG   billing + lib/db.ts   refund estimate→actual; logUsage()
```

## Layer inventory

| Concern | Lives in | State backing | Status |
|---|---|---|---|
| Identity / API key | `lib/auth.ts` | Supabase | solid |
| Pay on website (collect card) | `api/setup-payment.ts`, `lib/billing.ts` (`createSetupIntent`, `ensureStripeCustomer`) | Stripe + Supabase | solid |
| Balance / per-call allocation | `lib/billing.ts` (`accrueCharge`, `sweepAccount`, `refundAccrual`) | Supabase (`pending_charges`, `charges`, RPCs) | solid |
| Spend cap / freeze on failure | `lib/billing.ts` + `api/stripe-webhook.ts` | Supabase | solid |
| Monthly quota + per-minute rate | `lib/quota.ts` | **in-memory `Map`** | ⚠ per-instance |
| Provider allocation by task | `lib/routing/router.ts` (`PROVIDERS_BY_TASK`, `selectProvider`) | Supabase stats | works, see gaps |
| Multi-account rate-limit routing | `lib/key-pool.ts` (`withKeyRetry`, `keyPool`) | **in-memory `Map`** | ⚠ per-instance |
| Provider catalog | `lib/providers/registry.ts` | static + generated JSON | solid |
| Cost / pricing | `lib/pricing.ts` (`providerCostFor`, `trueUpCost`) | static table | partial |

## Gaps, ranked by impact on the real product

### G1 — Routing state is in-memory; you will still get flagged (CRITICAL)
`key-pool.ts` and `quota.ts` both hold state in a process-local `Map`. On Vercel
Fluid Compute there are **many function instances**. A key cooled down after a 429
on instance A is still "fresh" on instance B, so the fleet collectively keeps
hammering a limited account — the exact thing you're trying to prevent. `quota.ts`
already flags this: *"switch to Upstash Redis when scale matters."*
**Fix:** move cooldown + token-bucket state to Upstash Redis (already a dependency).
Until this lands, multi-account spreading is best-effort per-lambda, not real.

### G2 — Reactive only: you react to 429, you don't avoid the flag
The pool backs off *after* a provider returns 429. "Flagged for too much traffic"
often happens via abuse heuristics *before* a clean 429, and a ban can outlast a
5-minute cooldown. There's no proactive per-key budget (e.g. "≤ N calls per key per
rolling window"). **Decision needed:** add a proactive per-key rate budget, not just
reactive backoff.

### G3 — Round-robin assumes all accounts are equal
`getKey()` is plain round-robin. If your accounts have different limits/tiers, RR
over-uses the smallest. **Fix:** weighted selection (per-key weight or
least-recently-used by remaining budget).

### G4 — Two competing "allocate the provider" systems
`lib/routing/router.ts` (task-type → best provider by success/latency) and
`lib/bureau.ts` (category → creditworthiness score) overlap. `router.ts` is the
product one; the bureau is hackathon. **Decision needed:** make `router.ts` the
single allocator and treat the bureau score as an optional input, or retire it.

### G5 — Accounts are env-var pools; adding one means a redeploy
Keys come from a comma-separated env var (`ANTHROPIC_API_KEY="k1,k2,k3"`). You said
you'll set up *more* accounts over time — today that's an env edit + redeploy, and
the pool can't be scoped/rotated per provider without code. **Decision needed:**
keep env pools (simple) or move account inventory into Supabase for dynamic
add/disable.

### G6 — Cost tracking is a static table
`lib/pricing.ts` estimates cost per call from a static map; only LLM providers true
up to actual. For accurate per-call allocation across many paid APIs you'll want
real cost per provider (their pricing) captured per call.

### G7 — Supabase RPC + schema dependencies
Billing relies on RPCs (`increment_pending_and_decrement_cap`, `decrement_pending`,
`credit_spend_cap`) and tables (`pending_charges`, `charges`, account columns). These
migrations must be present in any environment you deploy to — verify before launch.

## Two-dimensional protection (your answer: BOTH)

You need to protect two different "users" at once, and they are different axes.
Today's code only really covers Axis A.

```
                 Axis B: per END-CUSTOMER fairness/isolation
                 (one customer can't exhaust a pool or get us flagged)
                        ▲
            customer X  │   ┌──────────────────────────────┐
            customer Y  │   │   shared upstream capacity    │
            customer Z  │   └──────────────────────────────┘
                        └───────────────────────────────────►
                 Axis A: per UPSTREAM-ACCOUNT spreading
                 (our N keys per provider, none gets flagged)
```

**Axis A — upstream account protection (partially built).**
`key-pool.ts` spreads our traffic across our keys for a provider. Needs G1 (Redis),
G2 (proactive per-key budget), G3 (weighting). This keeps any single *upstream*
account under its limit.

**Axis B — end-customer isolation (NOT built).**
`quota.ts` caps a customer's total calls, but there is no *fairness* layer: nothing
stops one customer from consuming the entire shared key-pool capacity for a provider
and starving everyone else — or driving the aggregate volume that gets an upstream
account flagged. The two axes are coupled: a customer's budget is ultimately a slice
of the aggregate upstream capacity.

**Recommended model — a two-tier token system, both tiers in Redis:**
1. **Customer tier (Axis B):** per `(account_id, provider)` rolling-window budget.
   Enforced first. A noisy customer hits *their own* ceiling and 429s without
   touching anyone else's headroom.
2. **Account-pool tier (Axis A):** per `(provider_key)` rolling budget + cooldown.
   `selectKey` picks the key with the most remaining headroom (weighted), not blind
   round-robin. Reserve a token here only after the customer tier passes.
3. **Invariant to maintain:** Σ(customer budgets in flight) ≤ Σ(pool key budgets).
   If customer demand exceeds aggregate upstream capacity, you shed load at the
   customer tier (fair) instead of getting an account banned (catastrophic).

This makes G1 the hard dependency for *both* axes: without shared Redis state,
neither per-customer fairness nor per-key spreading holds across instances.

## What you do NOT need from the hackathon
- x402 / CDP on-chain settlement (`lib/x402`, `api/bureau.ts`) — agent-pays-in-USDC
  is a different product than card-on-file.
- Credit score, `cited.md`, auto-downgrade, ClickHouse ledger, Langfuse, Composio,
  Pioneer accuracy judging — demo narrative, not load-bearing for routing+billing.

## Suggested build order (BOTH axes)
1. **G1 — Redis foundation.** Move `quota.ts` token buckets AND `key-pool.ts`
   cooldown state to Upstash Redis. Nothing else is real until shared. (Unblocks A+B.)
2. **Axis B — customer tier.** Add per-`(account_id, provider)` rolling-window budget
   in Redis, enforced before key selection. Fair shedding under load.
3. **Axis A — pool tier (G2/G3).** Per-key rolling budget + weighted/headroom-based
   `selectKey`, proactive (not just 429-reactive).
4. **G4** Collapse to one allocator (`router.ts`); bureau score optional input.
5. **G5/G6** Dynamic account inventory in Supabase + real per-call cost capture.
