import { installInvariant } from "./index.js";

const key = typeof process !== "undefined" ? process.env?.INVARIANT_PL_KEY : undefined;
if (key) {
  installInvariant({
    pl_key: key,
    base_url: process.env?.INVARIANT_BASE_URL,
  });
}
