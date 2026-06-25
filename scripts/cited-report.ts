#!/usr/bin/env tsx
/**
 * Generate cited.md (the public credit report) from the live ClickHouse ledger
 * and commit it to GitHub through Composio (CLAUDE.md step 6).
 *
 *   npx tsx scripts/cited-report.ts          # generate + write locally + commit
 *   npx tsx scripts/cited-report.ts --local  # generate + write locally only
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildCitedMd } from "../lib/report/cited.js";
import { commitFile, composioEnabled } from "../lib/composio/client.js";

async function main() {
  const localOnly = process.argv.includes("--local");
  // Stamp passed in so the generator stays deterministic / testable.
  const stamp = new Date().toISOString();
  const md = await buildCitedMd(stamp);

  writeFileSync("cited.md", md);
  console.log(`wrote cited.md (${md.length} bytes)\n`);
  console.log(md.split("\n").slice(0, 22).join("\n"));
  console.log("…\n");

  if (localOnly) return;
  if (!composioEnabled()) {
    console.log("COMPOSIO_API_KEY unset — skipping commit.");
    return;
  }

  console.log("committing cited.md through Composio → GitHub…");
  const res = await commitFile(
    "cited.md",
    md,
    `chore(bureau): credit report ${stamp.slice(0, 19)}Z`,
  );
  if (res.ok) {
    console.log("✅ committed:", res.url || res.sha);
  } else {
    console.log("❌ commit failed:", res.error);
    process.exitCode = 2;
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
