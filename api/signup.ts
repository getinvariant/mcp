// Signup endpoint.
//
// Flow:
//   1. User logs in via Auth0 in your frontend (or any OAuth-capable MCP client).
//   2. Frontend (or client) POSTs to /api/signup with the Authorization: Bearer <jwt> header.
//   3. We verify the JWT, then create an account row keyed on the JWT's `sub` claim.
//   4. Idempotent — calling /api/signup twice returns the existing account.
//
// This is the consent point: by hitting this endpoint the user accepts TOS
// and is told their tier + quota. No other endpoint accepts their token until
// they've signed up (auth.ts returns 403 with a pointer here).

import { randomBytes } from "node:crypto";
import {
  getAccountByAuth0Sub,
  createAccount,
  updateAccountTier,
} from "../lib/db.js";
import { verifyAuth0Token, extractBearer } from "../lib/auth0.js";
import { tierDefaults } from "../lib/tiers.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = extractBearer(req.headers["authorization"]);
  if (!token) {
    return res.status(401).json({
      error: "Missing Authorization: Bearer <jwt> header",
    });
  }

  const verified = await verifyAuth0Token(token);
  if (!verified.ok) {
    return res.status(verified.status).json({ error: verified.error });
  }

  const claims = verified.claims;
  const tier = claims["https://invariant.dev/tier"] || "free";
  const limits = tierDefaults(tier);

  // Optional TOS acceptance flag from the request body — we record consent
  // but don't gate on it for the demo. Flip the `requireTosAccept` switch
  // when you publish a real TOS page.
  const body = (req.body || {}) as { accept_tos?: boolean };
  const requireTosAccept = false; // change to true once /terms is live
  if (requireTosAccept && !body.accept_tos) {
    return res.status(400).json({
      error: "Must accept Terms of Service. POST { accept_tos: true }.",
      tos_url: "https://invariant.dev/terms",
    });
  }

  // Idempotent: if already exists, just return it.
  const existing = await getAccountByAuth0Sub(claims.sub);
  if (existing) {
    return res.status(200).json({
      ok: true,
      already_existed: true,
      account: publicAccount(existing),
    });
  }

  // Random pl_key — MUST NOT be derived from the Auth0 sub. sub is not a
  // secret (it appears in JWT payloads, server logs, support tickets); a
  // derived pl_key would let anyone who sees the sub forge a working
  // x-pl-key header and bypass JWT auth entirely (lib/auth.ts accepts
  // pl_key as a peer to Bearer). 24 bytes = 192 bits — way past brute-force.
  // Lookup stability is provided by auth0_sub, which already has a unique
  // index (migration.sql).
  const plKey = `pl_jwt_${randomBytes(24).toString("hex")}`;

  const account = await createAccount({
    plKey,
    email: claims.email,
    auth0Sub: claims.sub,
    tier,
    monthlyQuota: limits.monthlyQuota,
    perMinuteRate: limits.perMinuteRate,
  });
  if (!account) {
    return res.status(500).json({ error: "Account creation failed" });
  }

  return res.status(201).json({
    ok: true,
    already_existed: false,
    account: publicAccount(account),
    tier_limits: limits,
  });
}

/**
 * Strip internal fields before returning. pl_key + stripe_customer_id are
 * sensitive so we only expose the safe subset to the client.
 */
function publicAccount(a: any) {
  return {
    id: a.id,
    email: a.email,
    tier: a.tier,
    monthly_quota: a.monthly_quota,
    per_minute_rate: a.per_minute_rate,
    created_at: a.created_at,
  };
}
