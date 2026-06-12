#!/usr/bin/env tsx
/**
 * Ledger validation harness.
 *
 *   npx tsx scripts/ledger-check.ts
 *
 * Enabled (CLICKHOUSE_URL set): inits the table, inserts synthetic calls for
 * two paid geocoders, then prints raw rows + creditworthiness scores.
 * Disabled: prints the score SQL it would run + the real per-call costs,
 * proving the pricing table is wired.
 */
import "dotenv/config";
import {
  ledgerEnabled,
  initLedger,
  recordCall,
  rawRows,
  scoreProviders,
  SCORE_SQL,
  type CallRecord,
} from "../lib/ledger/clickhouse.js";
import { providerCostFor } from "../lib/pricing.js";

async function main() {
  console.log("ledgerEnabled():", ledgerEnabled());

  if (!ledgerEnabled()) {
    console.log("\n--- scoreProviders SQL it WOULD run ---");
    console.log(SCORE_SQL.trim());
    console.log("\n--- real per-call cost (cents) ---");
    console.log(
      "google_maps geocode:",
      providerCostFor("google_maps", "geocode", { address: "1 Infinite Loop" }),
    );
    console.log(
      "mapbox geocode:",
      providerCostFor("mapbox", "geocode", { text: "1 Infinite Loop" }),
    );
    process.exit(0);
  }

  await initLedger();

  // cents -> dollars for the ledger's cost_usd column
  const gCost = providerCostFor("google_maps", "geocode", {}) / 100;
  const mCost = providerCostFor("mapbox", "geocode", {}) / 100;

  const synthetic: CallRecord[] = [
    { account_id: "acct_test", category: "maps", provider: "google_maps", action: "geocode", cost_usd: gCost, success: 1, accuracy: 0.98, latency_ms: 140 },
    { account_id: "acct_test", category: "maps", provider: "google_maps", action: "geocode", cost_usd: gCost, success: 1, accuracy: 0.95, latency_ms: 160 },
    { account_id: "acct_test", category: "maps", provider: "mapbox", action: "geocode", cost_usd: mCost, success: 1, accuracy: 0.9, latency_ms: 110 },
    { account_id: "acct_test", category: "maps", provider: "mapbox", action: "geocode", cost_usd: mCost, success: 0, accuracy: 0.0, latency_ms: 90 },
  ];
  for (const rec of synthetic) await recordCall(rec);

  console.log("\n--- rawRows('maps') ---");
  console.table(await rawRows("maps"));

  console.log("\n--- scoreProviders('maps') ---");
  console.table(await scoreProviders("maps"));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
