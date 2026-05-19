// Warehouse picker — Tokyo ↔ SF Bay.
// For 15 candidates (8 Tokyo + 7 SF Bay), pull current temperature and
// re-price the asking monthly rent in BTC using live BTC/USD.

import { geocode } from "./lib/geocode.mjs";
import { weather } from "./lib/weather.mjs";
import { btcUsd } from "./lib/crypto.mjs";

async function main() {
  // TODO:
  //   1. Define 15 candidates as { address, monthly_rent_usd }:
  //      8 in Tokyo, 7 in SF Bay. Use plausible neighborhoods + rents.
  //   2. Fetch btcUsd() once.
  //   3. In parallel for each candidate: geocode → weather →
  //      rent_btc = monthly_rent_usd / btc_usd.
  //   4. console.log a ranked table: address · temp_c · rent_btc.
}

main();
