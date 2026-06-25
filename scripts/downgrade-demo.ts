#!/usr/bin/env tsx
/**
 * Auto-downgrade (CLAUDE.md step 7) — zero manual steps.
 *
 *   npx tsx scripts/downgrade-demo.ts [category]
 *
 * 1. Reads the live bureau recommendation (who gets our money now).
 * 2. Forces the CURRENT WINNER to underdeliver — real ledger rows with paid
 *    cost but injected outages, so its creditworthiness craters.
 * 3. Keeps degrading until the bureau REROUTES to the rival (revenue cutoff).
 * 4. Regenerates + commits a fresh cited.md credit report through Composio.
 * 5. Fires a downgrade alert through Composio.
 */
import "dotenv/config";
import { bureauRecommend } from "../lib/bureau.js";
import { runBureauCall } from "../lib/bureau/call.js";
import { buildCitedMd } from "../lib/report/cited.js";
import { commitFile, postAlert, composioEnabled } from "../lib/composio/client.js";
import { startTrace } from "../lib/trace/langfuse.js";
import { writeFileSync } from "node:fs";

const CATEGORY = process.argv[2] || "maps";
const PROBE = { google_maps: { address: "Times Square, New York" }, mapbox: { text: "Times Square, New York" } } as Record<string, any>;

function money(p: any): string {
  return p ? `${p.provider} (score ${Number(p.score.toPrecision(3))}, $${p.total_cost_usd.toFixed(5)} spent)` : "—";
}

async function main() {
  console.log(`\n=== AUTO-DOWNGRADE: category "${CATEGORY}" ===\n`);

  // One Langfuse trace for the whole downgrade, with the four bureau spans.
  const trace = startTrace("bureau.downgrade", { metadata: { category: CATEGORY } });

  const before = await bureauRecommend(CATEGORY);
  if (!before.best || before.ranked.length < 2) {
    console.error("need ≥2 scored providers to demo a reroute. Run some calls first.");
    process.exit(1);
  }
  const target = before.best.provider; // current winner — we'll degrade it
  const rival = before.ranked.find((p) => p.provider !== target)!.provider;
  trace.event("route-decision", { category: CATEGORY }, { best: target, rival });
  console.log("money routes to →", money(before.best));
  console.log("rival on deck   →", money(before.ranked.find((p) => p.provider !== target)));
  console.log(`\ninjecting outages into the WINNER (${target}) while ${rival} keeps serving…\n`);

  let flipped = false;
  let rounds = 0;
  let wastedSpend = 0;
  while (!flipped && rounds < 12) {
    rounds++;
    const accSpan = trace.span("accuracy-judgment", { provider: target, round: rounds });
    const paySpan = trace.span("x402-payment", { provider: target, round: rounds });
    // Degrade the current winner: paid, but it underdelivers.
    const bad = await runBureauCall({
      providerId: target,
      action: "geocode",
      params: PROBE[target] || {},
      category: CATEGORY,
      fault: "outage",
    });
    wastedSpend += bad.cost_usd;
    accSpan.end({ accuracy: bad.accuracy, success: bad.success });
    paySpan.end({ cost_usd: bad.cost_usd, leg: "us→vendor (underdelivered)" });
    // Rival keeps delivering for real.
    await runBureauCall({
      providerId: rival,
      action: "geocode",
      params: PROBE[rival] || {},
      category: CATEGORY,
    });

    const now = await bureauRecommend(CATEGORY);
    const t = now.ranked.find((p) => p.provider === target);
    console.log(
      `  round ${rounds}: ${target} score=${t ? Number(t.score.toPrecision(3)) : "?"} success=${t ? Math.round(t.success_rate * 100) : "?"}%  →  best=${now.best?.provider}`,
    );
    if (now.best && now.best.provider !== target) flipped = true;
  }

  const after = await bureauRecommend(CATEGORY);
  trace.event(
    "downgrade",
    { target },
    { rerouted_to: after.best?.provider, flipped, rounds, wasted_spend_usd: wastedSpend },
  );
  void trace.flush();
  console.log("\n--- RESULT ---");
  console.log("revenue cutoff  →", target, "loses the route");
  console.log("money REROUTES to →", money(after.best));
  console.log(`wasted spend on degraded ${target}: $${wastedSpend.toFixed(5)} (paid, underdelivered)`);
  console.log("\nreason:", after.reason);

  if (!flipped) {
    console.log("\n⚠️  did not flip within the round cap — score gap was too wide.");
  }

  // Fresh credit report + alert, both through Composio. Zero manual steps.
  const stamp = new Date().toISOString();
  const md = await buildCitedMd(stamp);
  writeFileSync("cited.md", md);

  if (composioEnabled()) {
    console.log("\ncommitting downgraded credit report through Composio…");
    const c = await commitFile("cited.md", md, `chore(bureau): auto-downgrade — reroute ${target}→${after.best?.provider}`);
    console.log(c.ok ? `✅ committed: ${c.url}` : `❌ commit failed: ${c.error}`);

    const alert = await postAlert(
      `${target} downgraded in "${CATEGORY}"`,
      `Creditworthiness collapsed after injected outages. Revenue rerouted ${target} → ${after.best?.provider}. ` +
        `Wasted spend on ${target}: $${wastedSpend.toFixed(5)}. New report committed to cited.md.`,
    );
    console.log(alert.ok ? `✅ alert fired via ${alert.via}${alert.url ? " " + alert.url : ""}` : `❌ alert failed: ${alert.error}`);
  } else {
    console.log("\nCOMPOSIO_API_KEY unset — wrote cited.md locally, alert to console only.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
