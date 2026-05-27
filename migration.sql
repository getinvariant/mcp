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
