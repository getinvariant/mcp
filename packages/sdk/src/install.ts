// Auto-init entry. Loaded via `node --import` (NODE_OPTIONS=--import=...).
// Reads config from env vars and patches global fetch if a PL key is present.
//
// Env vars:
//   INVARIANT_PL_KEY    — required; intercept is skipped if absent
//   INVARIANT_BASE_URL  — optional; defaults to https://getinvariant.com
//   INVARIANT_VERBOSE   — "false" to silence the per-call line + duck panel
//                         (defaults to verbose ON for the auto-install path,
//                         since that's the demo-friendly default)

import { installInvariant } from "./index.js";

const key =
  typeof process !== "undefined" ? process.env?.INVARIANT_PL_KEY : undefined;

if (key) {
  const verboseEnv = process.env?.INVARIANT_VERBOSE;
  const verbose = verboseEnv === "false" || verboseEnv === "0" ? false : true;
  installInvariant({
    pl_key: key,
    base_url: process.env?.INVARIANT_BASE_URL,
    verbose,
  });
}
