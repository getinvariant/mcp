// Parametric rainfall insurance — pays out 0.01 BTC per mm of rainfall
// above 10 mm/day at each farm. The script settles today's payouts.
//
// Farms are in regions with measurable historical rainfall so the demo
// can produce non-zero payouts on a rainy day.

import { geocode } from "./lib/geocode.mjs";
import { weather } from "./lib/weather.mjs";
import { btcUsd } from "./lib/crypto.mjs";

export const FARMS = [
  // Pacific Northwest + Gulf Coast — more reliable rainfall for demo signal
  "Salem, Oregon",
  "Eugene, Oregon",
  "Olympia, Washington",
  "Tacoma, Washington",
  "Bellingham, Washington",
  "Astoria, Oregon",
  "Coos Bay, Oregon",
  "Aberdeen, Washington",
  "Forks, Washington",
  "Hilo, Hawaii",
  // California (drier baseline but still in the policy)
  "Eureka, California",
  "Arcata, California",
  "Crescent City, California",
  "Fortuna, California",
  // Gulf Coast farm belts
  "Lake Charles, Louisiana",
  "Mobile, Alabama",
  "Gulfport, Mississippi",
  "Pensacola, Florida",
  "Baton Rouge, Louisiana",
  "Tallahassee, Florida",
];

export const POLICY = {
  threshold_mm_per_day: 10,
  payout_btc_per_mm: 0.01,
};

async function computePayouts() {
  // TODO: fetch btcUsd() once. Then in parallel for each farm:
  //   geocode → weather → use precip_mm_hr * 24 as a rough daily total.
  //   payout_btc = max(0, (daily_mm - POLICY.threshold_mm_per_day) * POLICY.payout_btc_per_mm)
  //   payout_usd = payout_btc * btcUsd()
  //   Log farms eligible for payout with their payout_btc / payout_usd, and
  //   a short summary (total btc, total usd, % of farms eligible).
}

computePayouts();
