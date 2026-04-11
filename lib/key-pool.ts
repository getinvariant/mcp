interface KeyState {
  key: string;
  cooldownUntil: number;
  consecutiveFailures: number;
}

class KeyPool {
  private pools = new Map<string, KeyState[]>();
  private cursors = new Map<string, number>();

  /**
   * Parse comma-separated keys from an env var.
   * Single key still works — fully backwards compatible.
   */
  private getOrCreatePool(envVar: string): KeyState[] {
    if (this.pools.has(envVar)) return this.pools.get(envVar)!;

    const raw = process.env[envVar];
    if (!raw) {
      this.pools.set(envVar, []);
      return [];
    }

    const keys = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const pool = keys.map((key) => ({
      key,
      cooldownUntil: 0,
      consecutiveFailures: 0,
    }));
    this.pools.set(envVar, pool);
    this.cursors.set(envVar, 0);
    return pool;
  }

  /**
   * Round-robin key selection that skips keys in cooldown.
   * If all keys are cooling down, returns the one with the shortest wait.
   */
  getKey(envVar: string): string | null {
    const pool = this.getOrCreatePool(envVar);
    if (pool.length === 0) return null;

    const now = Date.now();
    const cursor = this.cursors.get(envVar) || 0;

    for (let i = 0; i < pool.length; i++) {
      const idx = (cursor + i) % pool.length;
      const state = pool[idx];
      if (now >= state.cooldownUntil) {
        this.cursors.set(envVar, (idx + 1) % pool.length);
        return state.key;
      }
    }

    const shortest = pool.reduce((a, b) =>
      a.cooldownUntil < b.cooldownUntil ? a : b,
    );
    return shortest.key;
  }

  hasKeys(envVar: string): boolean {
    return this.getOrCreatePool(envVar).length > 0;
  }

  hasAvailableKey(envVar: string): boolean {
    const pool = this.getOrCreatePool(envVar);
    const now = Date.now();
    return pool.some((s) => now >= s.cooldownUntil);
  }

  reportRateLimit(envVar: string, key: string, retryAfterMs?: number): void {
    const pool = this.pools.get(envVar);
    if (!pool) return;
    const state = pool.find((s) => s.key === key);
    if (!state) return;

    state.consecutiveFailures++;
    // Exponential backoff: 30s → 60s → 120s → 240s, capped at 5 min
    const backoff =
      retryAfterMs ||
      Math.min(30_000 * Math.pow(2, state.consecutiveFailures - 1), 300_000);
    state.cooldownUntil = Date.now() + backoff;
  }

  reportSuccess(envVar: string, key: string): void {
    const pool = this.pools.get(envVar);
    if (!pool) return;
    const state = pool.find((s) => s.key === key);
    if (state) {
      state.consecutiveFailures = 0;
      state.cooldownUntil = 0;
    }
  }

  getStats(envVar: string): {
    total: number;
    available: number;
    inCooldown: number;
  } {
    const pool = this.getOrCreatePool(envVar);
    const now = Date.now();
    const available = pool.filter((s) => now >= s.cooldownUntil).length;
    return { total: pool.length, available, inCooldown: pool.length - available };
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

/**
 * Execute a fetch using the key pool with automatic retry on 429.
 *
 * @param envVar   - the env var name that holds the comma-separated keys
 * @param fn       - receives a key, returns the fetch Response
 * @param maxRetries - total attempts before giving up (default 3 × pool size, min 3)
 */
export async function withKeyRetry(
  envVar: string,
  fn: (key: string) => Promise<Response>,
  maxRetries?: number,
): Promise<{ response: Response; key: string }> {
  const stats = keyPool.getStats(envVar);
  const attempts = maxRetries ?? Math.max(3, stats.total * 3);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const key = keyPool.getKey(envVar);
    if (!key) throw new Error(`No API keys configured for ${envVar}`);

    const response = await fn(key);

    if (response.status === 429) {
      const retryMs = parseRetryAfter(response);
      keyPool.reportRateLimit(envVar, key, retryMs);

      if (keyPool.hasAvailableKey(envVar)) continue;

      // All keys in cooldown — brief pause before next attempt
      const waitMs = Math.min(retryMs ?? 5_000, 10_000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    keyPool.reportSuccess(envVar, key);
    return { response, key };
  }

  // Final fallback attempt
  const key = keyPool.getKey(envVar)!;
  const response = await fn(key);
  if (response.status !== 429) keyPool.reportSuccess(envVar, key);
  return { response, key };
}
