// Live monitor for the routing rate-limit state in Redis.
//
// This is the "is it actually working" view: it reads the SHARED state every
// instance writes to, so seeing tokens drain and cooldowns appear here proves
// the fleet-wide limiting is real (not per-lambda). No app server needed.
//
//   npx tsx scripts/pool-monitor.ts            # one-shot snapshot
//   npx tsx scripts/pool-monitor.ts --watch 2  # refresh every 2s
//
// Key shapes it decodes:
//   kp:tb:<env>:<id>  per-upstream-key budget   (Axis A)
//   kp:cd:<env>:<id>  per-upstream-key cooldown (Axis A)
//   cb:<account>:<provider>  per-customer budget (Axis B)
//   q:<account>       per-customer per-minute rate

import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error(
    "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.\n" +
      "Set them in your shell or .env, then re-run. See the setup notes for where to get them.",
  );
  process.exit(1);
}

const redis = new Redis({ url, token });

async function scanAll(match: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 200 });
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return keys;
}

function age(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

async function snapshot() {
  const ping = await redis.ping();
  const [tb, cd, cb, q] = await Promise.all([
    scanAll("kp:tb:*"),
    scanAll("kp:cd:*"),
    scanAll("cb:*"),
    scanAll("q:*"),
  ]);

  console.log(`\n── routing state @ ${new Date().toISOString()}  (redis ping: ${ping}) ──`);

  console.log(`\nAxis A — upstream-key budgets (${tb.length})`);
  for (const k of tb.sort()) {
    const h = (await redis.hgetall(k)) as { t?: string; s?: string } | null;
    const tokens = h?.t != null ? Number(h.t).toFixed(1) : "?";
    const updated = h?.s != null ? age(Number(h.s)) : "?";
    console.log(`  ${k.replace("kp:tb:", "")}  tokens=${tokens}  updated=${updated} ago`);
  }

  console.log(`\nAxis A — cooldowns (${cd.length})`);
  if (cd.length === 0) console.log("  (none — no keys backed off)");
  for (const k of cd.sort()) {
    const h = (await redis.hgetall(k)) as { until?: string; fails?: string } | null;
    const until = h?.until != null ? Number(h.until) : 0;
    const remaining = Math.max(0, Math.round((until - Date.now()) / 1000));
    console.log(`  ${k.replace("kp:cd:", "")}  cooling for ${remaining}s  fails=${h?.fails ?? "?"}`);
  }

  console.log(`\nAxis B — customer per-provider budgets (${cb.length})`);
  for (const k of cb.sort()) {
    const h = (await redis.hgetall(k)) as { t?: string } | null;
    console.log(`  ${k.replace("cb:", "")}  tokens=${h?.t != null ? Number(h.t).toFixed(1) : "?"}`);
  }

  console.log(`\nPer-customer rate buckets: ${q.length}`);
}

async function main() {
  const watchIdx = process.argv.indexOf("--watch");
  if (watchIdx === -1) {
    await snapshot();
    return;
  }
  const everyS = Number(process.argv[watchIdx + 1] || 2);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen
    await snapshot();
    await new Promise((r) => setTimeout(r, everyS * 1000));
  }
}

main().catch((e) => {
  console.error("monitor error:", e.message);
  process.exit(1);
});
