// Offline validation for the routing rate-limit primitives (no Redis, no
// Supabase). Exercises the in-memory fallback paths so behavior is verifiable
// without infra. Run: npx tsx scripts/ratelimit-test.ts

// Ensure the fallback path: unset Upstash so redis() returns null.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
// db.ts builds a Supabase client at import; give it a dummy URL so the module
// loads offline. The resolver's Supabase query then fails and falls back to env.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_KEY ||= "offline-test-key";

import { consume } from "../lib/ratelimit/token-bucket.js";
import { checkCustomerProviderBudget } from "../lib/ratelimit/customer.js";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

async function main() {
  // 1. Token bucket: capacity 2 → two pass, third blocks with a retry hint.
  const k = "test:bucket:1";
  const a = await consume({ key: k, capacity: 2, ratePerMinute: 2 });
  const b = await consume({ key: k, capacity: 2, ratePerMinute: 2 });
  const c = await consume({ key: k, capacity: 2, ratePerMinute: 2 });
  check("bucket allows up to capacity", a.ok && b.ok);
  check("bucket blocks past capacity", !c.ok);
  check("blocked call returns a retryAfterMs", c.retryAfterMs > 0);

  // 2. Key pool: 2 keys @ rpm 2 → 4 acquires succeed, 5th throttles.
  process.env.TEST_POOL_KEY = "alpha,beta";
  process.env.TEST_POOL_KEY_RPM = "2,2";
  const { keyPool } = await import("../lib/key-pool.js");
  check("hasKeys is synchronous + true", keyPool.hasKeys("TEST_POOL_KEY") === true);

  const ids = new Set<string>();
  let oks = 0;
  let throttled = false;
  for (let i = 0; i < 6; i++) {
    const acq = await keyPool.acquire("TEST_POOL_KEY");
    if (acq && "key" in acq) {
      oks++;
      ids.add(acq.id);
    } else if (acq && "retryAfterMs" in acq) {
      throttled = true;
    }
  }
  check("pool spreads across both accounts", ids.size === 2);
  check("pool serves aggregate budget then throttles (4 ok)", oks === 4);
  check("pool throttles once budgets are exhausted", throttled);

  // 3. Customer budget: per-(account, provider) ceiling enforced.
  let custOk = 0;
  let custBlocked = false;
  for (let i = 0; i < 4; i++) {
    const r = await checkCustomerProviderBudget("acct-1", "mapbox", 3);
    if (r.ok) custOk++;
    else custBlocked = true;
  }
  check("customer budget allows up to its limit (3)", custOk === 3);
  check("customer budget blocks the over-limit call", custBlocked);

  // 4. Isolation: a different account is unaffected by acct-1's spend.
  const other = await checkCustomerProviderBudget("acct-2", "mapbox", 3);
  check("other customer is isolated (own budget intact)", other.ok);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
