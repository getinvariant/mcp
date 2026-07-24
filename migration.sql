create table accounts (
  id uuid primary key default gen_random_uuid(),
  pl_key text unique not null,
  email text,
  tier text not null default 'free',
  monthly_quota int not null default 500,
  per_minute_rate int not null default 10,
  created_at timestamptz default now()
);

-- Option B additions: Auth0 sub for OAuth-authenticated accounts,
-- stripe_customer_id for billing reconciliation.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth0_sub text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_auth0_sub ON accounts(auth0_sub) WHERE auth0_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_stripe_customer ON accounts(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Machine-to-machine provisioning (/api/provision): a trusted embedding product
-- (e.g. Freebuff) provisions an account for one of ITS users, keyed on that
-- user's STABLE external id — never on email. Keying on email would let anyone
-- who knows an address retrieve that user's pl_key; external_id is opaque and
-- authenticated by the caller's service credential. Unique so retries/concurrent
-- provisions for the same user converge on one account.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_external_id ON accounts(external_id) WHERE external_id IS NOT NULL;

create table usage_log (
  id bigint generated always as identity primary key,
  account_id uuid references accounts(id),
  provider_id text not null,
  action text not null,
  success boolean not null,
  created_at timestamptz default now()
);

create table monthly_usage (
  account_id uuid references accounts(id),
  provider_id text not null,
  month text not null,
  count int not null default 0,
  primary key (account_id, provider_id, month)
);

create index idx_usage_log_account on usage_log(account_id, created_at);
create index idx_monthly_usage_account on monthly_usage(account_id, month);

create table if not exists routing_stats (
  account_id      uuid    not null references accounts(id) on delete cascade,
  task_type       text    not null,
  provider        text    not null,
  total_calls     integer not null default 0,
  success_count   integer not null default 0,
  sum_latency_ms  bigint  not null default 0,
  last_latency_ms real    not null default 0,
  last_success    boolean not null default true,
  last_updated_at timestamptz not null default now(),
  primary key (account_id, task_type, provider)
);

create table if not exists routing_events (
  id          bigserial primary key,
  account_id  uuid    not null references accounts(id) on delete cascade,
  task_type   text    not null,
  call_index  integer not null,
  provider    text    not null,
  success     boolean not null,
  latency_ms  real    not null,
  rates_after jsonb   not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_routing_events_account_task_call
  on routing_events (account_id, task_type, call_index);

ALTER TABLE routing_stats ADD COLUMN IF NOT EXISTS context TEXT NOT NULL DEFAULT 'global';
ALTER TABLE routing_events ADD COLUMN IF NOT EXISTS context TEXT NOT NULL DEFAULT 'global';

ALTER TABLE routing_stats DROP CONSTRAINT IF EXISTS routing_stats_pkey;
ALTER TABLE routing_stats ADD PRIMARY KEY (account_id, task_type, provider, context);

CREATE INDEX IF NOT EXISTS idx_routing_events_account_task_ctx
  ON routing_events(account_id, task_type, context, call_index);

-- Card-on-file postpaid billing.
-- payment_method_id: pm_... saved via SetupIntent at signup.
-- card_validated_at: set by setup_intent.succeeded webhook; gates spend.
-- spend_cap_cents_remaining: pre-capture trust limit, bumps after first capture clears.
-- pending_cents: accrued, un-swept micro-charges. Hourly cron or threshold sweeps it.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS payment_method_id text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS card_validated_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS spend_cap_cents_remaining int NOT NULL DEFAULT 200;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pending_cents int NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS billing_frozen boolean NOT NULL DEFAULT false;

-- One row per provider call we owe money for. Sweeps roll many of these
-- into one PaymentIntent. Kept after sweep for audit; charge_id links back.
CREATE TABLE IF NOT EXISTS pending_charges (
  id          bigserial primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  provider_id text not null,
  amount_cents int not null,
  charge_id   bigint,                    -- null until swept
  created_at  timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_pending_charges_unswept
  ON pending_charges(account_id) WHERE charge_id IS NULL;

-- One row per PaymentIntent. status mirrors Stripe.
CREATE TABLE IF NOT EXISTS charges (
  id                bigserial primary key,
  account_id        uuid not null references accounts(id) on delete cascade,
  amount_cents      int not null,
  status            text not null,        -- 'requires_action' | 'succeeded' | 'failed'
  stripe_intent_id  text unique,
  idempotency_key   text unique not null,
  failure_reason    text,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_charges_account ON charges(account_id, created_at DESC);

-- Atomic accrue. Decrements cap and bumps pending only if cap allows.
-- Returns the new pending_cents so the caller can decide whether to sweep.
CREATE OR REPLACE FUNCTION increment_pending_and_decrement_cap(
  p_account_id uuid,
  p_amount int
) RETURNS TABLE(pending_cents int) AS $$
  UPDATE accounts
     SET pending_cents = pending_cents + p_amount,
         spend_cap_cents_remaining = spend_cap_cents_remaining - p_amount
   WHERE id = p_account_id
     AND spend_cap_cents_remaining >= p_amount
     AND billing_frozen = false
  RETURNING pending_cents;
$$ LANGUAGE sql;

-- Settle side of the same counter. Called from sweepAccount after rows
-- are claimed, so we subtract exactly what was claimed (not what we read
-- before claiming).
CREATE OR REPLACE FUNCTION decrement_pending(
  p_account_id uuid,
  p_amount int
) RETURNS void AS $$
  UPDATE accounts
     SET pending_cents = greatest(0, pending_cents - p_amount)
   WHERE id = p_account_id;
$$ LANGUAGE sql;

-- Refund half of the cap math. Used by refundAccrual when an LLM call
-- consumed fewer tokens than the estimate. Always increments; not monotonic
-- because real overcharges have to come back to the user.
CREATE OR REPLACE FUNCTION credit_spend_cap(
  p_account_id uuid,
  p_amount int
) RETURNS void AS $$
  UPDATE accounts
     SET spend_cap_cents_remaining = spend_cap_cents_remaining + p_amount
   WHERE id = p_account_id;
$$ LANGUAGE sql;

-- Monotonic cap raise. Called from payment_intent.succeeded; never lowers.
CREATE OR REPLACE FUNCTION bump_spend_cap_if_lower(
  p_account_id uuid,
  p_new_cap int
) RETURNS void AS $$
  UPDATE accounts
     SET spend_cap_cents_remaining = greatest(spend_cap_cents_remaining, p_new_cap)
   WHERE id = p_account_id;
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────────────────────────────────
-- feat/routing: multi-account routing (Axis A) + cost capture (G6)
-- ─────────────────────────────────────────────────────────────────────────

-- G5: dynamic upstream-account inventory. One row per API account we own for a
-- provider. lib/providers/accounts.ts reads this (env var stays the fallback),
-- so we add/disable accounts without a redeploy. `weight` biases selection;
-- `rpm_limit` sizes that account's token budget in the key pool.
CREATE TABLE IF NOT EXISTS provider_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  env_var    text NOT NULL,            -- e.g. 'ANTHROPIC_API_KEY' — groups accounts per provider
  api_key    text NOT NULL,
  rpm_limit  int  NOT NULL DEFAULT 60, -- this account's sustained requests/minute
  weight     int  NOT NULL DEFAULT 60, -- selection bias; default to rpm_limit
  enabled    boolean NOT NULL DEFAULT true,
  label      text,                     -- human note, e.g. 'mapbox acct #2'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_accounts_env_enabled_idx
  ON provider_accounts (env_var) WHERE enabled;

-- G6: capture the real per-call cost (cents Invariant pays the vendor) on every
-- usage row so per-customer / per-provider spend is queryable from one place.
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS cost_cents int NOT NULL DEFAULT 0;
