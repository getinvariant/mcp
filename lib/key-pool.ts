// Axis A — upstream-account spreading.
//
// We front each provider with several API accounts we own and spread traffic so
// none gets rate-limited or flagged. This rewrite moves the load-bearing state
// (cooldowns + per-key budgets) into Redis so it holds across Vercel instances —
// a key cooled down on one lambda is cooled down for the whole fleet. Falls back
// to per-process memory only when Upstash isn't configured.
//
// Selection is PROACTIVE: each key carries a token budget sized to its rpm, so a
// key at its limit is skipped BEFORE we send the request that would earn a 429.
// Among eligible keys we pick the one with the most headroom (which, because
// capacity scales with rpm, naturally favors higher-limit accounts).
//
// Public surface preserved: `keyPool.hasKeys()` stays synchronous (used in
// provider isAvailable()), and `withKeyRetry(envVar, fn)` keeps its signature so
// the ~10 providers calling it are untouched.

import { resolveKeys, hasEnvKeys, type ProviderKey } from "./providers/accounts.js";
import { redis } from "./ratelimit/redis.js";
import { consume, peek } from "./ratelimit/token-bucket.js";

type Acquired = { key: string; id: string };
type Throttled = { retryAfterMs: number };

function isThrottled(a: Acquired | Throttled): a is Throttled {
  return (a as Throttled).retryAfterMs !== undefined;
}

// In-memory cooldown fallback (only used when Upstash is absent).
const localCooldown = new Map<string, { until: number; fails: number }>();

function cdKey(envVar: string, id: string): string {
  return `kp:cd:${envVar}:${id}`;
}
function tbArgs(envVar: string, k: ProviderKey) {
  return { key: `kp:tb:${envVar}:${k.id}`, capacity: k.rpm, ratePerMinute: k.rpm };
}

class KeyPool {
  /** Synchronous, env-based: "is this provider configured at all?" */
  hasKeys(envVar: string): boolean {
    return hasEnvKeys(envVar);
  }

  private async cooldownUntil(envVar: string, id: string): Promise<number> {
    const r = redis();
    if (!r) return localCooldown.get(cdKey(envVar, id))?.until ?? 0;
    try {
      const v = await r.hget(cdKey(envVar, id), "until");
      return v != null ? Number(v) : 0;
    } catch {
      return 0;
    }
  }

  async reportRateLimit(envVar: string, id: string, retryAfterMs?: number): Promise<void> {
    const r = redis();
    const k = cdKey(envVar, id);
    const fails = (r ? Number((await safe(() => r.hget(k, "fails"))) ?? 0) : localCooldown.get(k)?.fails ?? 0) + 1;
    // Exponential backoff: 30s → 60s → 120s → 240s, capped at 5 min, unless the
    // upstream told us exactly how long via Retry-After.
    const backoff = retryAfterMs || Math.min(30_000 * 2 ** (fails - 1), 300_000);
    const until = Date.now() + backoff;
    if (!r) {
      localCooldown.set(k, { until, fails });
      return;
    }
    try {
      await r.hset(k, { until, fails });
      await r.pexpire(k, backoff + 1000);
    } catch {
      localCooldown.set(k, { until, fails });
    }
  }

  async reportSuccess(envVar: string, id: string): Promise<void> {
    const r = redis();
    const k = cdKey(envVar, id);
    if (!r) {
      localCooldown.delete(k);
      return;
    }
    try {
      await r.del(k);
    } catch {
      localCooldown.delete(k);
    }
  }

  /**
   * Acquire one key for an upstream call. Skips cooled-down keys, enforces each
   * key's rpm budget, and returns the most-headroom key — or a retryAfterMs when
   * every key is cooled/exhausted, or null when none are configured.
   */
  async acquire(envVar: string): Promise<Acquired | Throttled | null> {
    const keys = await resolveKeys(envVar);
    if (keys.length === 0) return null;

    const now = Date.now();
    const eligible: ProviderKey[] = [];
    let soonest = Number.POSITIVE_INFINITY;
    for (const k of keys) {
      const until = await this.cooldownUntil(envVar, k.id);
      if (now < until) {
        soonest = Math.min(soonest, until);
        continue;
      }
      eligible.push(k);
    }
    if (eligible.length === 0) {
      return { retryAfterMs: soonest === Infinity ? 5000 : Math.max(0, soonest - now) };
    }

    // Rank by headroom (peek, no spend). capacity scales with rpm so this also
    // weights toward bigger accounts; weight nudges ties.
    const scored = await Promise.all(
      eligible.map(async (k) => ({ k, head: (await peek(tbArgs(envVar, k))) * (k.weight / k.rpm) })),
    );
    scored.sort((a, b) => b.head - a.head);

    let minRetry = Number.POSITIVE_INFINITY;
    for (const { k } of scored) {
      const res = await consume(tbArgs(envVar, k));
      if (res.ok) return { key: k.key, id: k.id };
      minRetry = Math.min(minRetry, res.retryAfterMs);
    }
    return { retryAfterMs: minRetry === Infinity ? 1000 : minRetry };
  }

  /**
   * Last-resort key when every account is over budget but a paying request still
   * needs serving: round-robins by env cursor, ignores budget, still skips
   * cooled-down keys when possible. Best-effort; may return a cooled key if all
   * are cooled.
   */
  async bestEffortKey(envVar: string): Promise<string | null> {
    const keys = await resolveKeys(envVar);
    if (keys.length === 0) return null;
    const now = Date.now();
    for (const k of keys) {
      if (now >= (await this.cooldownUntil(envVar, k.id))) return k.key;
    }
    return keys[0].key;
  }

  async getStats(envVar: string): Promise<{
    total: number;
    available: number;
    inCooldown: number;
    keys: { id: string; rpm: number; headroom: number; cooled: boolean }[];
  }> {
    const keys = await resolveKeys(envVar);
    const now = Date.now();
    const detail = await Promise.all(
      keys.map(async (k) => {
        const cooled = now < (await this.cooldownUntil(envVar, k.id));
        const headroom = await peek(tbArgs(envVar, k));
        return { id: k.id, rpm: k.rpm, headroom, cooled };
      }),
    );
    const available = detail.filter((d) => !d.cooled).length;
    return { total: keys.length, available, inCooldown: keys.length - available, keys: detail };
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

export const keyPool = new KeyPool();

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a fetch through the key pool with proactive budgeting + retry on 429.
 * Signature unchanged from the in-memory version so providers don't change.
 *
 * @param envVar     env var holding the comma-separated keys (also the inventory key)
 * @param fn         receives a key, returns the fetch Response
 * @param maxRetries total attempts before the last-resort call (default 3 × pool size, min 3)
 */
export async function withKeyRetry(
  envVar: string,
  fn: (key: string) => Promise<Response>,
  maxRetries?: number,
): Promise<{ response: Response; key: string }> {
  const keys = await resolveKeys(envVar);
  const attempts = maxRetries ?? Math.max(3, keys.length * 3);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const acq = await keyPool.acquire(envVar);
    if (acq === null) throw new Error(`No API keys configured for ${envVar}`);

    if (isThrottled(acq)) {
      // Every key cooled or over budget — wait out the shortest, then retry.
      await sleep(Math.min(acq.retryAfterMs, 10_000));
      continue;
    }

    const response = await fn(acq.key);
    if (response.status === 429) {
      await keyPool.reportRateLimit(envVar, acq.id, parseRetryAfter(response));
      continue;
    }
    await keyPool.reportSuccess(envVar, acq.id);
    return { response, key: acq.key };
  }

  // Last resort so we don't hard-fail a billed request after exhausting retries.
  const key = await keyPool.bestEffortKey(envVar);
  if (!key) throw new Error(`No API keys configured for ${envVar}`);
  const response = await fn(key);
  return { response, key };
}
