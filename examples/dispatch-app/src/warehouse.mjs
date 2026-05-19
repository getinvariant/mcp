// Tokyo ↔ SF Bay warehouse candidate analysis.
//
// We've shortlisted 15 warehouse spots — 8 in Tokyo, 7 in SF Bay — with
// asking rents in USD. For each candidate we pull current weather and the
// live BTC/USD price, then re-price the rent in BTC. Flag candidates with
// extreme temperatures (>30°C or <5°C) since HVAC drives operating cost.

import { geocode } from "./lib/geocode.mjs";
import { weather } from "./lib/weather.mjs";
import { btcUsd } from "./lib/crypto.mjs";

export const CANDIDATES = [
  // Tokyo
  { address: "Shibuya, Tokyo", monthly_rent_usd: 18000 },
  { address: "Shinjuku, Tokyo", monthly_rent_usd: 22000 },
  { address: "Roppongi, Tokyo", monthly_rent_usd: 19500 },
  { address: "Ginza, Tokyo", monthly_rent_usd: 28000 },
  { address: "Akihabara, Tokyo", monthly_rent_usd: 15500 },
  { address: "Asakusa, Tokyo", monthly_rent_usd: 12000 },
  { address: "Shinagawa, Tokyo", monthly_rent_usd: 17500 },
  { address: "Shibaura, Tokyo", monthly_rent_usd: 13500 },
  // SF Bay
  { address: "SOMA, San Francisco", monthly_rent_usd: 21000 },
  { address: "Mission Bay, San Francisco", monthly_rent_usd: 19000 },
  { address: "Dogpatch, San Francisco", monthly_rent_usd: 16500 },
  { address: "West Oakland, Oakland", monthly_rent_usd: 11000 },
  { address: "Emeryville, CA", monthly_rent_usd: 13500 },
  { address: "Richmond, CA", monthly_rent_usd: 10000 },
  { address: "Hayward, CA", monthly_rent_usd: 9500 },
];

export const HVAC_FLAGS = { hot_c: 30, cold_c: 5 };

async function analyzeCandidates() {
  // TODO: fetch btcUsd() once, then in parallel for each candidate:
  //   geocode → weather → compute monthly_rent_btc = rent_usd / btc.
  //   Flag candidates with temp_c > 30 or temp_c < 5 as HVAC-expensive.
  //   console.log a ranked table: address, temp, rent_btc, flagged?
}

analyzeCandidates();
