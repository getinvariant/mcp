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

  // Synthetic pl_key derived from sub so older FK joins still work.
  const plKey = `pl_jwt_${claims.sub.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`;

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
