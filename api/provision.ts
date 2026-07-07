// Admin provisioning endpoint.
//
// Flow:
//   1. A trusted server (e.g. Freebuff) holds a shared PROVISION_ADMIN_SECRET.
//   2. It POSTs { email } with header `x-admin-secret: <secret>`.
//   3. We get-or-create an account for that email and return its pl_key.
//   4. Idempotent — calling twice for the same email returns the same key.
//
// Unlike /api/signup (user-consented, Auth0-JWT keyed on `sub`), this is a
// machine-to-machine path: the *caller* is trusted via a shared secret and
// vouches for the email. No end-user token is involved. Use it to auto-seed
// accounts for users of an embedding product so their generated apps get an
// Invariant key without a separate signup step.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { getAccountByEmail, createAccount } from "../lib/db.js";
import { tierDefaults } from "../lib/tiers.js";

/** Constant-time string compare — avoids leaking the secret via timing. */
function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ---- Auth: shared admin secret -----------------------------------------
  const expected = process.env.PROVISION_ADMIN_SECRET;
  if (!expected) {
    // Fail closed: a missing secret must never mean "anyone can provision".
    console.error("[provision] PROVISION_ADMIN_SECRET not configured");
    return res.status(503).json({ error: "Provisioning not configured" });
  }
  const presented = req.headers["x-admin-secret"];
  if (typeof presented !== "string" || !secretsMatch(presented, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Validate body -----------------------------------------------------
  const body = (req.body || {}) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return res.status(400).json({ error: "email (string) is required" });
  }

  // ---- Idempotent get-or-create ------------------------------------------
  // getAccountByEmail is deterministic even without a unique index on email:
  // it returns the OLDEST row for the address (db.ts orders by created_at).
  // So repeat calls always converge on the same account/key.
  const existing = await getAccountByEmail(email);
  if (existing) {
    return res.status(200).json({ key: existing.pl_key, already_existed: true });
  }

  // Random, unguessable key. `pl_prov_` prefix marks admin-provisioned
  // accounts (distinct from `pl_jwt_` signups) for easy auditing; auth.ts
  // only requires the `pl_` prefix, so it authenticates like any other key.
  // 24 bytes = 192 bits of entropy — far past brute-force.
  const plKey = `pl_prov_${randomBytes(24).toString("hex")}`;
  const limits = tierDefaults("free");

  const account = await createAccount({
    plKey,
    email,
    tier: "free",
    monthlyQuota: limits.monthlyQuota,
    perMinuteRate: limits.perMinuteRate,
  });
  if (!account) {
    return res.status(500).json({ error: "Account creation failed" });
  }

  // Re-fetch by email so two racing callers (email has no unique index)
  // converge on the oldest row's key instead of each returning its own
  // freshly-minted duplicate. Harmless if there was no race.
  const canonical = await getAccountByEmail(email);
  return res.status(201).json({
    key: canonical?.pl_key ?? account.pl_key,
    already_existed: false,
  });
}
