create table accounts (
  id uuid primary key default gen_random_uuid(),
  pl_key text unique not null,
  email text,
  tier text not null default 'free',
  monthly_quota int not null default 500,
  per_minute_rate int not null default 10,
  created_at timestamptz default now()
);

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

insert into accounts (pl_key, tier, monthly_quota, per_minute_rate)
values ('pl_demo_key_2026', 'free', 500, 20);
