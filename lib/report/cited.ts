// cited.md — the public CREDIT REPORT for paid APIs.
//
// Sourced from the SAME rolling ClickHouse query that routes our money
// (scoreProviders), so the published grade can never drift from the enforced
// one. Each entry shows provider, creditworthiness score, real $ spent, the
// outcomes behind the grade, and recent delivery evidence.

import {
  scoreProviders,
  rawRows,
  type ProviderScore,
} from "../ledger/clickhouse.js";

const CATEGORIES = ["maps"] as const;

function sig(n: number, p = 3): string {
  return Number(n.toPrecision(p)).toString();
}

function grade(score: number, ranked: ProviderScore[]): string {
  // Letter grade relative to the best in category — a credit-report feel.
  if (ranked.length === 0) return "—";
  const top = ranked[0].score || 1;
  const r = score / top;
  if (r >= 0.95) return "A";
  if (r >= 0.7) return "B";
  if (r >= 0.45) return "C";
  if (r >= 0.2) return "D";
  return "F";
}

async function categorySection(category: string): Promise<string> {
  const ranked = await scoreProviders(category);
  if (ranked.length === 0) {
    return `### ${category}\n\n_No paid calls recorded yet._\n`;
  }

  const lines: string[] = [];
  lines.push(`### Category: \`${category}\``);
  lines.push("");
  lines.push(
    "| Rank | Provider | Grade | Creditworthiness | Real $ spent | Calls | Success | Accuracy | $/call |",
  );
  lines.push(
    "|-----:|----------|:-----:|-----------------:|-------------:|------:|--------:|---------:|-------:|",
  );
  ranked.forEach((p, i) => {
    lines.push(
      `| ${i + 1} | ${i === 0 ? "**" + p.provider + "**" : p.provider} | ${grade(p.score, ranked)} | ${sig(p.score)} | $${p.total_cost_usd.toFixed(5)} | ${p.calls} | ${Math.round(p.success_rate * 100)}% | ${Math.round(p.avg_accuracy * 100)}% | $${p.avg_cost_usd.toFixed(5)} |`,
    );
  });
  lines.push("");

  const best = ranked[0];
  lines.push(
    `**Money routes to \`${best.provider}\`** — best value delivered per dollar ` +
      `(accuracy ${Math.round(best.avg_accuracy * 100)}% × success ${Math.round(best.success_rate * 100)}% ÷ $${best.avg_cost_usd.toFixed(5)}/call = ${sig(best.base_score)}).`,
  );
  lines.push("");

  const flagged = ranked.filter((p) => p.health < 1);
  if (flagged.length) {
    lines.push(
      "> **Leading signals (Airbyte):** " +
        flagged
          .map(
            (p) =>
              `\`${p.provider}\` ${p.status || "degraded"} — health ${sig(p.health)} docks score ${sig(p.base_score)}→${sig(p.score)} before any failed call`,
          )
          .join("; ") +
        ".",
    );
    lines.push("");
  }

  // Delivery evidence: recent real calls behind the grade.
  const rows = (await rawRows(category, 8)) as any[];
  if (rows.length) {
    lines.push("<details><summary>Delivery evidence (recent calls)</summary>");
    lines.push("");
    lines.push("| ts | provider | success | accuracy | $ cost | latency | x402 settlement |");
    lines.push("|----|----------|:-------:|---------:|-------:|--------:|-----------------|");
    for (const r of rows) {
      const tx = r.x402_tx
        ? `[\`${String(r.x402_tx).slice(0, 10)}…\`](https://sepolia.basescan.org/tx/${r.x402_tx})`
        : "—";
      lines.push(
        `| ${String(r.ts).replace("T", " ").slice(0, 19)} | ${r.provider} | ${r.success ? "✓" : "✗"} | ${Number(r.accuracy).toFixed(2)} | $${Number(r.cost_usd).toFixed(5)} | ${r.latency_ms}ms | ${tx} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Build the full cited.md credit report across all tracked paid categories.
 * `stamp` is the report time (passed in — the generator stays deterministic).
 */
export async function buildCitedMd(stamp: string): Promise<string> {
  const head = [
    "# cited.md — Invariant API Credit Bureau",
    "",
    "> The public credit report for paid APIs. Invariant fronts the vendor key, pays",
    "> per call with real money, and scores each provider on **value delivered per",
    "> dollar** from real transaction history. The highest-creditworthiness provider",
    "> gets our money; when a paid API underdelivers, its score drops and we reroute",
    "> to the rival. Scores are a rolling query over the ClickHouse ledger — not app",
    "> memory. Accuracy is judged by an LLM served on Pioneer; the agent→Invariant",
    "> leg settles in real Base Sepolia USDC via x402.",
    "",
    `_Generated ${stamp} from the live ledger._`,
    "",
    "---",
    "",
  ].join("\n");

  const sections: string[] = [];
  for (const c of CATEGORIES) sections.push(await categorySection(c));

  const foot = [
    "---",
    "",
    "**How the score works:** `creditworthiness = avg(accuracy) × success_rate ÷ avg(cost_usd)`.",
    "It is financial, not uptime: a provider that is cheap but wrong, or accurate but",
    "expensive, loses to the rival that delivers more correct answers per dollar.",
    "",
  ].join("\n");

  return head + sections.join("\n") + "\n" + foot;
}
