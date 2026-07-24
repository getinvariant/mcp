# PL Signup Orchestrator

Provisions ~700 API providers automatically by signing up across 6 aggregators (manual, one-time) and 70 standalone services (automated via Stagehand).

## Prerequisites

You need to do these once. Stop on any error — they all matter.

### 1. Node + deps

```bash
cd scripts/signup
npm install
```

Stagehand pulls Playwright; the first install downloads the bundled Chromium. ~200MB, takes a couple minutes.

### 2. Two Gmail App Passwords

App passwords let IMAP authenticate without OAuth. **Not** your regular Gmail password.

1. Go to https://myaccount.google.com/security and turn on 2-Step Verification on each Gmail account (if not already).
2. Visit https://myaccount.google.com/apppasswords while logged in as each account.
3. Generate one app password per account, name them "PL Signup Primary" and "PL Signup Secondary".
4. Save both 16-character codes — Google only shows them once.

### 3. Aggregator signups (automated)

The 6 aggregators are signed up by the same Stagehand agent. Keys land in
`creds/{name}.json` and are picked up by the enumerator automatically — you
do NOT need to paste them into `.env`. If you'd rather sign up manually
(faster for a one-off, ~10 min), you can; the orchestrator will read keys
from `.env` as a fallback.

### 4. Fill in `.env`

```bash
cp .env.example .env
# edit .env, fill in everything not blank in .env.example
```

Minimum required:
- `ANTHROPIC_API_KEY` (drives the Stagehand agent — you already have one)
- `GMAIL_PRIMARY` + `GMAIL_APP_PASSWORD_PRIMARY`
- `GMAIL_SECONDARY` + `GMAIL_APP_PASSWORD_SECONDARY`
- The 6 aggregator keys from step 3

Optional (recommended if you hit captchas): `NOPECHA_KEY` from https://nopecha.com (free tier 100 solves/day).

### 5. (Optional) Install NopeCHA browser extension for headed runs

If you watch the agent run (default), NopeCHA's free Chrome extension auto-solves reCAPTCHA without any API calls. Install it once in the Chromium profile Playwright launches.

## Running

One command end-to-end (recommended):

```bash
npm run all
```

That chains: aggregator signups → enumerate sub-providers → standalone signups → merge → smoke-test. Takes ~45-60 min.

Or step by step if you want to watch each phase:

```bash
# Step 1: automated signup for 6 aggregators (~5 min, sequential)
npm run signup-aggregators

# Step 2: pull catalogs from all 6 aggregators (~2 min, ~640 providers)
npm run enumerate

# Step 3: automated signup for 70 standalone providers (~30-45 min, parallel)
npm run signup

# Filter to one category or one provider for testing:
npx tsx orchestrator.ts signup weather
npx tsx orchestrator.ts signup openweather

# Step 4: merge aggregator + standalone configs
npm run merge

# Step 5: smoke-test every provider, mark live/dead
npm run smoke
```

After step 4, `data/generated-providers.json` exists. The main app's provider registry auto-loads it on the next boot — no further wiring needed.

## What the run produces

```
scripts/signup/
├── creds/                          # one json per provider with email/pw/key (gitignored)
│   ├── openweather.json
│   ├── mapbox.json
│   └── …
└── data/
    ├── aggregator.json             # ~640 rows from the 6 aggregators
    ├── standalone.json             # ~50-60 rows from automated signups
    ├── generated-providers.json    # merged + smoke-tested catalog
    └── signup-log.json             # detailed per-attempt log (debug failures)
```

## Tuning

- `SIGNUP_CONCURRENCY` (env, default 4): how many Chromium instances run in parallel. Bump to 8 on a 16GB Mac.
- `signup-agent.ts` → `localBrowserLaunchOptions.headless`: set `true` once you trust the flow to run unattended overnight.

## When things fail

The signup agent reports `SIGNUP_FAILED` and skips. The most common causes:

1. **Phone verification required** — provider added one since this list was compiled. Remove from `recipes/standalone.ts`.
2. **Credit card required for first key** — same. Remove or move to manual.
3. **Email rejected** — alias `+` is blocked. The agent auto-retries with a dot-fallback once.
4. **CAPTCHA hard wall** — install NopeCHA extension or set `NOPECHA_KEY`.

For any failure, `data/signup-log.json` has the full error string per provider. Cherry-pick failures and rerun with `npx tsx orchestrator.ts signup <name>`.

## Cost reminder

| Item | Cost |
| --- | --- |
| Anthropic API for the agent (~70 signups × ~$0.05) | ~$3.50 |
| NopeCHA (free tier, 100 solves/day) | $0 |
| CapSolver fallback (if NopeCHA exhausted, $0.80/1000 solves) | ~$0–2 |
| **Total** | **~$5** |
