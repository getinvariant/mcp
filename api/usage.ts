import { authenticateRequest } from "../lib/auth.js";
import { getUsage } from "../lib/db.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const account = auth.account!;
  const breakdown = await getUsage(account.id);
  const used = breakdown.reduce((sum, r) => sum + r.count, 0);

  // calculate reset date (first of next month)
  const now = new Date();
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);

  return res.status(200).json({
    tier: account.tier,
    quota: account.monthly_quota,
    per_minute_rate: account.per_minute_rate,
    used,
    remaining: Math.max(0, account.monthly_quota - used),
    resets,
    breakdown: breakdown.map((r) => ({
      provider: r.provider_id,
      count: r.count,
    })),
  });
}
