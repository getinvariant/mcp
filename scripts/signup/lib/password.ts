// Local password generator. No external vault dependency — credentials are
// persisted to creds/{provider}.json (gitignored) instead of Bitwarden so the
// user doesn't need to install another CLI before Wednesday.

import { randomBytes } from "node:crypto";

const ALPHA_LOWER = "abcdefghijklmnopqrstuvwxyz";
const ALPHA_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*";

export function generatePassword(length = 20): string {
  const pool = ALPHA_LOWER + ALPHA_UPPER + DIGITS + SYMBOLS;
  const bytes = randomBytes(length);
  let out = "";
  // Guarantee at least one of each character class so weird signup validators pass.
  out += ALPHA_LOWER[bytes[0] % ALPHA_LOWER.length];
  out += ALPHA_UPPER[bytes[1] % ALPHA_UPPER.length];
  out += DIGITS[bytes[2] % DIGITS.length];
  out += SYMBOLS[bytes[3] % SYMBOLS.length];
  for (let i = 4; i < length; i++) {
    out += pool[bytes[i] % pool.length];
  }
  // Shuffle so the guaranteed chars aren't always at the front.
  return out.split("").sort(() => bytes[0] - bytes[1]).join("");
}
