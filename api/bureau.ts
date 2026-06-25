// Live credit-bureau data for the dashboard (CLAUDE.md step 8).
//
// GET /api/bureau?category=maps → per-provider creditworthiness scores, the
// real $ routed to each provider, and a recent-calls feed (the downgrade
// signal). Read-only aggregate over the ClickHouse ledger; no auth so the
// dashboard can poll it freely.

import {
  ledgerEnabled,
  scoreProviders,
  rawRows,
} from "../lib/ledger/clickhouse.js";

const CATEGORIES = ["maps"];

export default async function handler(req: any, res: any) {
  const category =
    (req.query?.category as string | undefined) ||
    (req.body?.category as string | undefined) ||
    null;

  if (!ledgerEnabled()) {
    return res.status(200).json({ configured: false, categories: [] });
  }

  const cats = category ? [category] : CATEGORIES;
  const out: any[] = [];
  for (const cat of cats) {
    const ranked = await scoreProviders(cat);
    const recent = (await rawRows(cat, 20)) as any[];
    const best = ranked[0] || null;
    out.push({
      category: cat,
      best: best?.provider ?? null,
      providers: ranked.map((p) => ({
        provider: p.provider,
        score: p.score,
        base_score: p.base_score,
        health: p.health,
        status: p.status,
        calls: p.calls,
        success_rate: p.success_rate,
        avg_accuracy: p.avg_accuracy,
        total_cost_usd: p.total_cost_usd,
        avg_cost_usd: p.avg_cost_usd,
        routed: best ? p.provider === best.provider : false,
      })),
      feed: recent.map((r) => ({
        ts: r.ts,
        provider: r.provider,
        success: Number(r.success) === 1,
        accuracy: Number(r.accuracy),
        cost_usd: Number(r.cost_usd),
        latency_ms: Number(r.latency_ms),
        x402_tx: r.x402_tx || "",
      })),
    });
  }

  return res.status(200).json({ configured: true, ts: Date.now(), categories: out });
}
