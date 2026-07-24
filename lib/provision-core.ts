// Pure, dependency-injected core of machine-to-machine account provisioning.
//
// Kept free of Supabase/Redis/HTTP so the idempotency + race behavior can be
// unit-tested with in-memory fakes (see provision-core.test.ts). api/provision.ts
// is the thin HTTP adapter that supplies real DB access, rate limiting, key
// generation, and audit logging.
//
// Contract (from the PR #578 review):
//   - Keyed on a STABLE externalUserId, never email.
//   - Idempotent: a retry — or a concurrent duplicate that lost the unique-index
//     race — converges on the same account/key with a success outcome.
//   - Rate limited; audited WITHOUT ever recording the pl_key.

export type ProvisionOutcome =
  | { kind: "ok"; key: string; alreadyExisted: boolean }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "error" };

export type ProvisionAuditEvent = {
  event: "provisioned" | "reused" | "rate_limited" | "error";
  externalId: string;
  alreadyExisted?: boolean;
};

export interface ProvisionDeps {
  /** Look up an account by external user id; null if not yet provisioned. */
  getByExternalId: (externalId: string) => Promise<{ pl_key: string } | null>;
  /** Create an account for this external user; null on failure (incl. unique-race). */
  createAccount: (
    externalId: string,
    email: string | null,
  ) => Promise<{ pl_key: string } | null>;
  /** Optional per-user rate limit; ok:false short-circuits with retryAfterMs. */
  rateLimit?: (
    externalId: string,
  ) => Promise<{ ok: boolean; retryAfterMs: number }>;
  /** Audit sink — receives non-secret events only (never the key). */
  audit?: (event: ProvisionAuditEvent) => void;
}

export interface ProvisionInput {
  externalUserId: string;
  email: string | null;
}

export async function provisionAccountCore(
  input: ProvisionInput,
  deps: ProvisionDeps,
): Promise<ProvisionOutcome> {
  const { externalUserId, email } = input;

  if (deps.rateLimit) {
    const rl = await deps.rateLimit(externalUserId);
    if (!rl.ok) {
      deps.audit?.({ event: "rate_limited", externalId: externalUserId });
      return { kind: "rate_limited", retryAfterMs: rl.retryAfterMs };
    }
  }

  // Fast path: already provisioned → return the same key (idempotent).
  const existing = await deps.getByExternalId(externalUserId);
  if (existing) {
    deps.audit?.({
      event: "reused",
      externalId: externalUserId,
      alreadyExisted: true,
    });
    return { kind: "ok", key: existing.pl_key, alreadyExisted: true };
  }

  const created = await deps.createAccount(externalUserId, email);
  if (created) {
    deps.audit?.({
      event: "provisioned",
      externalId: externalUserId,
      alreadyExisted: false,
    });
    return { kind: "ok", key: created.pl_key, alreadyExisted: false };
  }

  // Create failed. The likeliest cause is a concurrent provision that won the
  // unique-index race, or a retry after a partial success. Re-check: if a row
  // now exists, converge on it (still an idempotent success); otherwise it's a
  // genuine backend failure.
  const raced = await deps.getByExternalId(externalUserId);
  if (raced) {
    deps.audit?.({
      event: "reused",
      externalId: externalUserId,
      alreadyExisted: true,
    });
    return { kind: "ok", key: raced.pl_key, alreadyExisted: true };
  }

  deps.audit?.({ event: "error", externalId: externalUserId });
  return { kind: "error" };
}
