// Bureau routing: turn the rolling creditworthiness scores in ClickHouse into
// a single "who gets our money for this category" recommendation, with a
// human-readable credit rationale.

import {
  ledgerEnabled,
  scoreProviders,
  type ProviderScore,
} from "./ledger/clickhouse.js";

export interface BureauResult {
  category: string;
  configured: boolean; // ledgerEnabled()
  best: ProviderScore | null; // highest creditworthiness, or null if no data
  reason: string; // human-readable credit rationale
  ranked: ProviderScore[]; // all providers for the category, score DESC
}

function sig2(n: number): string {
  return Number(n.toPrecision(2)).toString();
}

export async function bureauRecommend(
  category: string,
): Promise<BureauResult> {
  if (!ledgerEnabled()) {
    return {
      category,
      configured: false,
      best: null,
      reason:
        "ledger not configured (CLICKHOUSE_URL unset) — no transaction history to score yet",
      ranked: [],
    };
  }

  const ranked = await scoreProviders(category);
  if (ranked.length === 0) {
    return {
      category,
      configured: true,
      best: null,
      reason: `no paid calls recorded for category '${category}' yet`,
      ranked: [],
    };
  }

  const best = ranked[0];
  let reason =
    `${best.provider} wins: ${best.calls} paid calls, ` +
    `${Math.round(best.success_rate * 100)}% success, ` +
    `${Math.round(best.avg_accuracy * 100)}% accuracy, ` +
    `$${best.avg_cost_usd.toFixed(4)}/call → creditworthiness ${sig2(best.score)}.`;

  if (ranked.length > 1) {
    const runnerUp = ranked[1];
    reason +=
      ` Beats ${runnerUp.provider} ` +
      `($${runnerUp.avg_cost_usd.toFixed(4)}/call, score ${sig2(runnerUp.score)}).`;
  }

  return { category, configured: true, best, reason, ranked };
}
