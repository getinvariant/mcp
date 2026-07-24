// Shared Upstash Redis handle for cross-instance rate-limit state.
//
// On Vercel Fluid Compute there are many function instances; any rate-limit or
// cooldown state kept in a process-local Map is invisible to the rest of the
// fleet, so the fleet collectively overruns an upstream account. This module is
// the single place we get a Redis client. When the env isn't configured we
// return null and callers fall back to in-memory (fine for local/dev, NOT for
// production spreading — that's the whole point of moving here).

import { Redis } from "@upstash/redis";

let client: Redis | null = null;

export function redisEnabled(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

/** The shared client, or null when Upstash isn't configured. Memoized. */
export function redis(): Redis | null {
  if (client) return client;
  if (!redisEnabled()) return null;
  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return client;
}
