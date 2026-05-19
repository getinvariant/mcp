// SF Bay delivery dispatch — weather-aware.
//
// We have 20 stops across SF, Oakland, and Berkeley. For each stop we pull
// current weather and flag any with precipitation above 2 mm/hr so the
// dispatcher can swap routes or delay drivers.

import { geocode } from "./lib/geocode.mjs";
import { weather } from "./lib/weather.mjs";

export const STOPS = [
  "Ferry Building, San Francisco",
  "Pier 39, San Francisco",
  "Mission Dolores, San Francisco",
  "Golden Gate Park, San Francisco",
  "Twin Peaks, San Francisco",
  "Coit Tower, San Francisco",
  "Lombard Street, San Francisco",
  "Ghirardelli Square, San Francisco",
  "Painted Ladies, San Francisco",
  "Embarcadero Station, San Francisco",
  "Lake Merritt, Oakland",
  "Jack London Square, Oakland",
  "Fox Theater, Oakland",
  "Rockridge BART, Oakland",
  "Telegraph Ave, Berkeley",
  "UC Berkeley, Berkeley",
  "Sather Gate, Berkeley",
  "Berkeley Marina, Berkeley",
  "Tilden Park, Berkeley",
  "Emeryville Public Market, Emeryville",
];

export const RAIN_THRESHOLD_MM_HR = 2;

async function dispatchStops() {
  // TODO: for each stop, geocode → weather. Use Promise.all so the 20 lookups
  // run in parallel. Return an array of { stop, temp_c, precip_mm_hr, rainy }.
  // Then console.log a short summary: how many stops are flagged rainy, and
  // list them.
}

dispatchStops();
