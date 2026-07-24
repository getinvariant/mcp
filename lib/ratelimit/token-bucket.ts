// Atomic token-bucket limiter, Redis-backed with an in-memory fallback.
//
// One primitive, three call sites: the per-account per-minute rate (quota.ts),
// the per-(account, provider) customer budget (Axis B, customer.ts), and the
// per-upstream-key budget (Axis A, key-pool.ts). Capacity = burst, refill =
// sustained rate. A bucket refills `refillPerMs` tokens per ms up to capacity.
//
// Redis path runs the whole refill-then-consume as a single Lua script so two
// concurrent instances can't both spend the last token. In-memory path mirrors
// the exact same math for environments without Upstash configured.

import { redis } from "./redis.js";

export interface BucketResult {
  ok: boolean;
  /** Tokens left after this call (>= 0). */
  remaining: number;
  /** ms until `cost` tokens are available again. 0 when ok. */
  retryAfterMs: number;
}

// Pure refill+consume. Returns the new state and the outcome. Shared by both
// backends so their behavior can't drift.
export function applyBucket(
  state: { tokens: number; ts: number } | undefined,
  capacity: number,
  refillPerMs: number,
  now: number,
  cost: number,
): { tokens: number; ts: number; result: BucketResult } {
  let tokens = state ? state.tokens : capacity;
  const elapsed = state ? Math.max(0, now - state.ts) : 0;
  tokens = Math.min(capacity, tokens + elapsed * refillPerMs);

  if (tokens >= cost) {
    tokens -= cost;
    return { tokens, ts: now, result: { ok: true, remaining: tokens, retryAfterMs: 0 } };
  }
  const deficit = cost - tokens;
  const retryAfterMs = refillPerMs > 0 ? Math.ceil(deficit / refillPerMs) : Number.MAX_SAFE_INTEGER;
  return { tokens, ts: now, result: { ok: false, remaining: tokens, retryAfterMs } };
}

// --- In-memory fallback (per-process; only used when Upstash is absent) ------
const localBuckets = new Map<string, { tokens: number; ts: number }>();

function consumeLocal(
  key: string,
  capacity: number,
  refillPerMs: number,
  cost: number,
): BucketResult {
  const now = Date.now();
  const next = applyBucket(localBuckets.get(key), capacity, refillPerMs, now, cost);
  localBuckets.set(key, { tokens: next.tokens, ts: next.ts });
  return next.result;
}

// KEYS[1]=bucket  ARGV=capacity, refillPerMs, now, cost, ttlMs
// Returns {allowed(0|1), retryAfterMs, remainingTokens*1000}
const BUCKET_LUA = `
local cap = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local h = redis.call('HMGET', KEYS[1], 't', 's')
local tokens = tonumber(h[1])
local ts = tonumber(h[2])
if tokens == nil then tokens = cap; ts = now end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(cap, tokens + elapsed * refill)
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  local deficit = cost - tokens
  if refill > 0 then retry = math.ceil(deficit / refill) else retry = 999999999 end
end
redis.call('HSET', KEYS[1], 't', tokens, 's', now)
redis.call('PEXPIRE', KEYS[1], ttl)
return {allowed, retry, math.floor(tokens * 1000)}
`;

export interface BucketArgs {
  key: string;
  /** Max burst (and the value tokens refill toward). */
  capacity: number;
  /** Sustained rate, expressed per minute. */
  ratePerMinute: number;
  /** Tokens this call wants. Default 1. */
  cost?: number;
}

/**
 * Consume `cost` tokens from the named bucket. Uses Redis when configured
 * (cross-instance correct), otherwise the in-memory fallback. Never throws —
 * a Redis hiccup degrades to the local bucket rather than failing the request.
 */
export async function consume(args: BucketArgs): Promise<BucketResult> {
  const cost = args.cost ?? 1;
  const refillPerMs = args.ratePerMinute / 60_000;
  // Keep the bucket alive a few windows past the last touch so idle keys expire.
  const ttlMs = Math.max(60_000, Math.ceil((args.capacity / refillPerMs) * 2));

  const r = redis();
  if (!r) return consumeLocal(args.key, args.capacity, refillPerMs, cost);

  try {
    const res = (await r.eval(
      BUCKET_LUA,
      [args.key],
      [args.capacity, refillPerMs, Date.now(), cost, ttlMs],
    )) as [number, number, number];
    return {
      ok: res[0] === 1,
      remaining: res[2] / 1000,
      retryAfterMs: res[1],
    };
  } catch (e) {
    console.warn(`[ratelimit] redis eval failed, falling back to memory: ${(e as Error).message}`);
    return consumeLocal(args.key, args.capacity, refillPerMs, cost);
  }
}

/**
 * Peek remaining tokens WITHOUT consuming — for headroom-based key selection.
 * Returns the projected token count after refill. Best-effort; on any failure
 * returns `capacity` (treat as fully available so selection still progresses).
 */
export async function peek(args: Omit<BucketArgs, "cost">): Promise<number> {
  const refillPerMs = args.ratePerMinute / 60_000;
  const r = redis();
  if (!r) {
    const next = applyBucket(localBuckets.get(args.key), args.capacity, refillPerMs, Date.now(), 0);
    return next.result.remaining;
  }
  try {
    const h = (await r.hmget(args.key, "t", "s")) as (string | number | null)[] | null;
    const tokens = h && h[0] != null ? Number(h[0]) : args.capacity;
    const ts = h && h[1] != null ? Number(h[1]) : Date.now();
    const elapsed = Math.max(0, Date.now() - ts);
    return Math.min(args.capacity, tokens + elapsed * refillPerMs);
  } catch {
    return args.capacity;
  }
}
