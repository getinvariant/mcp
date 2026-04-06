import { getUser, recordUsage, deductBalance } from "../auth/store.js";
import { config } from "../config.js";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

const rateLimitWindows = new Map<string, { windowStart: number; count: number }>();

export function checkRateLimit(apiKey: string): RateLimitResult {
  const now = Date.now();
  const windowMs = 60_000;

  let window = rateLimitWindows.get(apiKey);
  if (!window || now - window.windowStart > windowMs) {
    window = { windowStart: now, count: 0 };
    rateLimitWindows.set(apiKey, window);
  }

  const remaining = config.rateLimitPerMinute - window.count;
  const resetIn = Math.max(0, windowMs - (now - window.windowStart));

  if (window.count >= config.rateLimitPerMinute) {
    return { allowed: false, remaining: 0, resetIn };
  }

  return { allowed: true, remaining, resetIn };
}

export function trackUsage(
  apiKey: string,
  providerId: string,
  action: string,
  credits: number
): boolean {
  const window = rateLimitWindows.get(apiKey);
  if (window) window.count++;

  if (credits > 0) {
    if (!deductBalance(apiKey, credits)) return false;
  }

  recordUsage(apiKey, providerId, action, credits);
  return true;
}
