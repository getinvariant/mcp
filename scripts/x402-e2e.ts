#!/usr/bin/env tsx
/**
 * End-to-end x402 settlement check (CLAUDE.md step 5).
 *
 *   X402_ENABLED=true npx tsx scripts/x402-e2e.ts
 *
 * Stands up a minimal HTTP server mounting the REAL api/query handler, then
 * drives it as an agent would:
 *   1. unpaid POST  → expect HTTP 402 with x402 `accepts`
 *   2. paid POST via x402-fetch → real Base Sepolia USDC settles → 200
 * Then prints BOTH money legs: agent→us (x402_tx on-chain) and us→vendor
 * (cost_usd) straight from the ClickHouse ledger row.
 */
import "dotenv/config";
import http from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import queryHandler from "../api/query.js";
import { getAllAccounts } from "../lib/db.js";
import { rawRows } from "../lib/ledger/clickhouse.js";

function makeRes(res: http.ServerResponse) {
  const r: any = res;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (obj: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
    return r;
  };
  return r;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(d || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

async function main() {
  if (process.env.X402_ENABLED !== "true") {
    console.error("set X402_ENABLED=true to run this check");
    process.exit(1);
  }

  // A real account key for auth (x402 skips the card rail, so no card needed).
  const accts = await getAllAccounts();
  const acct = accts.find((a) => a.pl_key);
  if (!acct) throw new Error("no account with pl_key found");
  const plKey = acct.pl_key;

  const server = http.createServer(async (req, res) => {
    req.body = await readBody(req);
    return queryHandler(req, makeRes(res));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const url = `http://localhost:${port}/api/query`;

  const reqBody = {
    provider_id: "google_maps",
    action: "geocode",
    params: { address: "350 5th Ave, New York, NY" },
  };
  const headers = { "Content-Type": "application/json", "x-pl-key": plKey };

  // ── leg 0: unpaid → 402 ────────────────────────────────────────────────
  const unpaid = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(reqBody),
  });
  const unpaidJson: any = await unpaid.json();
  console.log(`\n[1] unpaid call  → HTTP ${unpaid.status}`);
  console.log(
    "    accepts:",
    JSON.stringify(unpaidJson?.accepts?.[0] ? {
      network: unpaidJson.accepts[0].network,
      maxAmountRequired: unpaidJson.accepts[0].maxAmountRequired,
      payTo: unpaidJson.accepts[0].payTo,
      asset: unpaidJson.accepts[0].asset,
    } : unpaidJson),
  );

  // ── leg 1: paid via x402-fetch (signs EIP-3009, settles on-chain) ──────
  const account = privateKeyToAccount(
    process.env.X402_PAYER_PRIVATE_KEY as `0x${string}`,
  );
  console.log(`\n[2] paying as ${account.address} via x402-fetch...`);
  const fetchWithPay = wrapFetchWithPayment(fetch, account as any);
  const paid = await fetchWithPay(url, {
    method: "POST",
    headers,
    body: JSON.stringify(reqBody),
  });
  const paidJson: any = await paid.json();
  console.log(`    paid call    → HTTP ${paid.status}`);
  if (paid.status !== 200) {
    console.log("    FAILURE body:", JSON.stringify(paidJson));
    server.close();
    process.exit(1);
  }
  console.log("    data:", JSON.stringify(paidJson?.data).slice(0, 100));

  const xpr = paid.headers.get("x-payment-response");
  let txHash = "";
  if (xpr) {
    const decoded: any = decodeXPaymentResponse(xpr);
    txHash = decoded?.txHash || decoded?.transaction || "";
    console.log("    settlement:", JSON.stringify(decoded));
  }

  // ── both money legs, from the ledger ───────────────────────────────────
  await new Promise((r) => setTimeout(r, 1500));
  const rows = (await rawRows("maps", 5)) as any[];
  const mine = rows.find((r) => r.x402_tx && r.x402_tx === txHash) || rows[0];
  console.log("\n[3] ledger row — BOTH money legs:");
  console.log("    agent→us  (x402_tx):", mine?.x402_tx);
  console.log("    us→vendor (cost_usd): $" + mine?.cost_usd, `(${mine?.provider})`);
  console.log("    success:", mine?.success, "accuracy:", mine?.accuracy);
  console.log(
    "\n    explorer: https://sepolia.basescan.org/tx/" + (txHash || mine?.x402_tx),
  );

  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
