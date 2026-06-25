#!/usr/bin/env tsx
/**
 * Simulate a provider status-page incident as a LEADING signal (Airbyte path).
 *
 *   npx tsx scripts/simulate-incident.ts <provider> [health] [status]
 *   npx tsx scripts/simulate-incident.ts mapbox 0.4 major_outage
 *   npx tsx scripts/simulate-incident.ts mapbox 1.0 operational   # clear it
 *
 * Writes one provider_context row (what scripts/airbyte_signals.py would sync
 * from the real status page) and prints the score before/after — proving the
 * incident docks the score with NO failed call from us.
 */
import "dotenv/config";
import { recordContextSignal, scoreProviders } from "../lib/ledger/clickhouse.js";

async function show(category: string) {
  const ranked = await scoreProviders(category);
  for (const p of ranked) {
    console.log(
      `   ${p.provider.padEnd(12)} score=${String(Number(p.score.toPrecision(3))).padEnd(7)} base=${String(Number(p.base_score.toPrecision(3))).padEnd(7)} health=${p.health} ${p.status ? "(" + p.status + ")" : ""}`,
    );
  }
  return ranked;
}

async function main() {
  const provider = process.argv[2] || "mapbox";
  const health = process.argv[3] ? parseFloat(process.argv[3]) : 0.4;
  const status = process.argv[4] || (health >= 1 ? "operational" : "major_outage");
  const category = "maps";

  console.log(`\nbefore — money routes to: (top of list)`);
  const before = await show(category);

  console.log(`\ninjecting leading signal: ${provider} health=${health} status=${status} (NO call made)`);
  await recordContextSignal({
    provider,
    source: "statuspage",
    status,
    health,
    note: "simulated status-page incident",
  });
  // small delay so the MergeTree insert is visible to the next SELECT
  await new Promise((r) => setTimeout(r, 1200));

  console.log(`\nafter — leading signal applied:`);
  const after = await show(category);

  const topBefore = before[0]?.provider;
  const topAfter = after[0]?.provider;
  console.log(
    `\nrouting ${topBefore === topAfter ? "unchanged (" + topAfter + ")" : "REROUTED " + topBefore + " → " + topAfter} — driven by the status page, before any failed call.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
