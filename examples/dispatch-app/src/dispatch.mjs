// SF Bay delivery dispatch — weather-aware.
// For 20 stops across SF / Oakland / Berkeley, pull current weather at each
// and flag any stop with precipitation above the threshold.

import { geocode } from "./lib/geocode.mjs";
import { weather } from "./lib/weather.mjs";

const RAIN_THRESHOLD_MM_HR = 2;

async function main() {
  // TODO:
  //   1. Choose 20 real addresses across SF / Oakland / Berkeley.
  //   2. In parallel (Promise.all): geocode each → weather at its lat/lon.
  //   3. Flag stops where precip_mm_hr > RAIN_THRESHOLD_MM_HR.
  //   4. console.log a short summary: total stops, # flagged, the flagged
  //      addresses with their precip values.
}

main();
