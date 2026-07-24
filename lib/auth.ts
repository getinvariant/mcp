// Dual-mode authentication.
//
// Mode 1 (legacy): `x-pl-key: pl_xxx` header — looked up directly in the
// accounts table. Kept for backwards-compatibility with existing CLI clients
// and the demo.
//
// Mode 2 (Option B / MCP-spec compliant): `Authorization: Bearer <jwt>` —
// Auth0-issued JWT. We verify, then look up or auto-provision an account
// keyed by the JWT's `sub` claim. Tier comes from a custom claim populated
// by an Auth0 post-login Action (sourced from Stripe).

import { getAccount, getAccountByAuth0Sub, createAccount } from "./db.js";
import type { Account } from "./db.js";
import {
  verifyAuth0Token,
  extractBearer,
  type PLAuth0Claims,
} from "./auth0.js";
import { tierDefaults } from "./tiers.js";

export interface AuthResult {
  ok: boolean;
  account?: Account;
  /** Present only on JWT auth path — useful for downstream audit/log. */
  claims?: PLAuth0Claims;
  error?: string;
  status?: number;
}

/**
 * Authenticate a request from either an Auth0 Bearer JWT or a legacy pl_key.
 * Prefers the JWT when both are present.
 */
export async function authenticateRequest(
  plKey: string | undefined,
  bearerHeader?: string | undefined,
): Promise<AuthResult> {
  // ---- JWT path ----------------------------------------------------------
  const token = extractBearer(bearerHeader);
  if (token) {
    const verified = await verifyAuth0Token(token);
    if (!verified.ok) {
      return { ok: false, error: verified.error, status: verified.status };
    }
    const account = await resolveAccountForJwt(verified.claims);
    if (!account) {
      return {
        ok: false,
        error:
          "Account not provisioned. Complete signup at POST /api/signup with this same Authorization header.",
        status: 403,
        claims: verified.claims,
      };
    }
    return { ok: true, account, claims: verified.claims };
  }

  // ---- Legacy pl_key path ------------------------------------------------
  if (!plKey || !plKey.startsWith("pl_")) {
    return { ok: false, error: "Missing or invalid API key", status: 401 };
  }
  const account = await getAccount(plKey);
  if (!account) {
    return { ok: false, error: "Unknown API key", status: 401 };
  }
  return { ok: true, account };
}

/**
 * Find the account for a verified JWT. Does NOT auto-provision — the user
 * must POST to /api/signup once before any other endpoint accepts their token.
 * This gives us a clear consent point for TOS, billing, and email collection
 * (instead of letting them silently accrue usage before they've agreed to
 * anything).
 */
async function resolveAccountForJwt(
  claims: PLAuth0Claims,
): Promise<Account | null> {
  return getAccountByAuth0Sub(claims.sub);
}
