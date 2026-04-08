import { Redis } from "@upstash/redis";
import type { Account } from "./db.js";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export interface QuotaResult {
  ok: boolean;
  remaining: number;
  error?: string;
}

export async function checkAndIncrement(
  plKey: string,
  account: Account
): Promise<QuotaResult> {
  const rateKey = `pl:rate:${plKey}`;
  const monthKey = `pl:month:${plKey}:${currentMonth()}`;

  // increment both counters atomically via pipeline
  const pipeline = redis.pipeline();
  pipeline.incr(rateKey);
  pipeline.incr(monthKey);
  const results = await pipeline.exec<[number, number]>();

  const minuteCount = results[0];
  const monthCount = results[1];

  // set TTLs on first increment
  if (minuteCount === 1) await redis.expire(rateKey, 60);
  if (monthCount === 1) await redis.expire(monthKey, 45 * 86400);

  if (minuteCount > account.per_minute_rate) {
    return { ok: false, remaining: 0, error: "Rate limit exceeded. Retry in 60s." };
  }

  if (monthCount > account.monthly_quota) {
    return { ok: false, remaining: 0, error: "Monthly quota exceeded." };
  }

  return { ok: true, remaining: account.monthly_quota - monthCount };
}
