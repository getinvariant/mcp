// Live key-pool health for the dashboard (repurposed from the bureau view).
//
// Surfaces the state that's otherwise invisible: per upstream account, how much
// rpm headroom is left and whether it's in cooldown. Pair with /api/routing-
// status (provider success rates) for the full picture.
//
// GET /api/pool-status?env=ANTHROPIC_API_KEY,MAPBOX_API_KEY

import { authenticateRequest } from "../lib/auth.js";
import { keyPool } from "../lib/key-pool.js";
import { redisEnabled } from "../lib/ratelimit/redis.js";

export default async function handler(req: any, res: any) {
  const auth = await authenticateRequest(
    req.headers["x-pl-key"] as string,
    req.headers["authorization"] as string | undefined,
  );
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const envs = String(req.query?.env || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const pools: Record<string, Awaited<ReturnType<typeof keyPool.getStats>>> = {};
  for (const env of envs) {
    pools[env] = await keyPool.getStats(env);
  }

  return res.status(200).json({
    // false here means routing state is per-instance, not fleet-wide — a flag
    // worth showing prominently on the dashboard.
    redis_backed: redisEnabled(),
    pools,
  });
}
