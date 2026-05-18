import "dotenv/config";
// One line that the user adds to their project. This patches global fetch.
import { installInvariant } from "../../packages/sdk/src/index.js";

const PL_KEY = process.env.INVARIANT_PL_KEY ?? process.env.PL_API_KEY;
if (!PL_KEY) {
  console.error("set INVARIANT_PL_KEY (or PL_API_KEY) in your .env first");
  process.exit(1);
}

installInvariant({
  pl_key: PL_KEY,
  base_url: process.env.INVARIANT_BASE_URL ?? "http://localhost:3000",
});

import { geocodeAddresses } from "./agent-code.js";

const addresses = [
  "Embarcadero, San Francisco",
  "Times Square, New York",
  "Shibuya, Tokyo",
  "Victoria Island, Lagos",
  "Bandra, Mumbai",
  "Le Marais, Paris",
];

console.log("\n  Invariant — places demo\n");
console.log("  one line installed. agent-code.ts uses plain fetch.\n");

(async () => {
  for (const addr of addresses) {
    const res = await geocodeAddresses(addr);
    // res is the Response from fetch — extract our visibility headers
    const routedTo = res.headers.get("x-invariant-routed-to") ?? "?";
    const context = res.headers.get("x-invariant-context") ?? "?";
    const ci = res.headers.get("x-invariant-call-index") ?? "?";
    const body = await res.json();
    const formatted = body?.features?.[0]?.properties?.formatted ?? "(no result)";
    const ok = res.ok ? "ok  " : "FAIL";
    console.log(`  ${ok}  ${addr.padEnd(34)} → ${routedTo.padEnd(8)} [${context.padEnd(10)}]  #${ci}`);
    console.log(`        resolved: ${formatted}`);
  }
  console.log("\n  done. open `invariant routing_status` (MCP) to see what the router learned.\n");
})();
