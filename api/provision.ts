// Machine-to-machine provisioning endpoint.
//
// Flow:
//   1. A trusted server (e.g. Freebuff) holds a shared PROVISION_ADMIN_SECRET.
//   2. It POSTs { externalUserId, email? } with header
//        Authorization: Bearer <secret>   (legacy: x-admin-secret: <secret>)
//   3. We get-or-create an account keyed on the STABLE externalUserId and
//      return its pl_key.
//   4. Idempotent — repeat/concurrent calls for the same externalUserId return
//      the same key.
//
// Why externalUserId and not email (PR #578 review): keying idempotency on email
// would let anyone who knows an address retrieve that user's proxy credential.
// externalUserId is opaque and the *caller* is authenticated via the shared
// secret and vouches for the mapping. No end-user token is involved.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { getAccountByExternalId, createAccount } from "../lib/db.js";
import { tierDefaults } from "../lib/tiers.js";
import { consume } from "../lib/ratelimit/token-bucket.js";
import {
  provisionAccountCore,
  type ProvisionAuditEvent,
} from "../lib/provision-core.js";

/** Constant-time string compare — avoids leaking the secret via timing. */
function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Accept `Authorization: Bearer <secret>` or legacy `x-admin-secret: <secret>`. */
function presentedSecret(req: any): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const legacy = req.headers["x-admin-secret"];
  return typeof legacy === "string" ? legacy : undefined;
}

// Provisioning is far cheaper than /api/query but still worth bounding so a
// leaked service secret can't mass-mint accounts. Per-externalUserId bucket.
const PROVISION_RPM = Number(process.env.PROVISION_RPM || 20);

// Structured audit line — captured by Vercel/Axiom logs. NEVER includes the key.
function auditProvision(event: ProvisionAuditEvent) {
  console.log(`[provision-audit] ${JSON.stringify(event)}`);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ---- Auth: shared service secret ---------------------------------------
  const expected = process.env.PROVISION_ADMIN_SECRET;
  if (!expected) {
    // Fail closed: a missing secret must never mean "anyone can provision".
    console.error("[provision] PROVISION_ADMIN_SECRET not configured");
    return res.status(503).json({ error: "Provisioning not configured" });
  }
  const presented = presentedSecret(req);
  if (typeof presented !== "string" || !secretsMatch(presented, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Validate body -----------------------------------------------------
  const body = (req.body || {}) as { externalUserId?: unknown; email?: unknown };
  const externalUserId =
    typeof body.externalUserId === "string" ? body.externalUserId.trim() : "";
  if (!externalUserId) {
    return res
      .status(400)
      .json({ error: "externalUserId (string) is required" });
  }
  const email =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim()
      : null;

  // ---- Delegate to the pure core with real dependencies ------------------
  const limits = tierDefaults("free");
  const outcome = await provisionAccountCore(
    { externalUserId, email },
    {
      getByExternalId: (id) => getAccountByExternalId(id),
      createAccount: (id, mail) =>
        createAccount({
          // `pl_prov_` marks admin-provisioned accounts (vs `pl_jwt_` signups)
          // for auditing; auth.ts only requires the `pl_` prefix.
          // 24 bytes = 192 bits of entropy — far past brute-force.
          plKey: `pl_prov_${randomBytes(24).toString("hex")}`,
          externalId: id,
          email: mail ?? undefined,
          tier: "free",
          monthlyQuota: limits.monthlyQuota,
          perMinuteRate: limits.perMinuteRate,
        }),
      rateLimit: async (id) => {
        const r = await consume({
          key: `provision:${id}`,
          capacity: PROVISION_RPM,
          ratePerMinute: PROVISION_RPM,
        });
        return { ok: r.ok, retryAfterMs: r.retryAfterMs };
      },
      audit: auditProvision,
    },
  );

  // ---- Map outcome to HTTP with explicit contracts -----------------------
  switch (outcome.kind) {
    case "ok":
      return res
        .status(outcome.alreadyExisted ? 200 : 201)
        .json({ key: outcome.key, already_existed: outcome.alreadyExisted });
    case "rate_limited":
      res.setHeader(
        "Retry-After",
        Math.ceil(outcome.retryAfterMs / 1000).toString(),
      );
      return res.status(429).json({
        error: "Too many requests",
        retry_after_ms: outcome.retryAfterMs,
      });
    case "error":
    default:
      // Generic — never leak Supabase internals to the caller (details are
      // logged server-side in createAccount).
      return res.status(500).json({ error: "Provisioning failed" });
  }
}
