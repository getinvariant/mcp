#!/usr/bin/env tsx
// Unit tests for the provisioning core (idempotency + race + rate-limit).
// Run: npx tsx provision-core.test.ts
//
// Pure/in-memory — no Supabase, Redis, or network. Covers the scenarios the
// PR #578 review asked for: first signup, immediate retry, concurrent
// duplicates, rate-limited, and a genuine backend failure.

import test from "node:test";
import assert from "node:assert/strict";

import {
  provisionAccountCore,
  type ProvisionAuditEvent,
  type ProvisionDeps,
} from "./lib/provision-core.js";

const USER = "user_abc123"; // stable external user id (NOT email)
const EMAIL = "dev+pr578@example.com";

// In-memory accounts store that emulates the accounts.external_id UNIQUE index:
// a second insert for the same external id fails (returns null), exactly like
// Supabase rejecting a duplicate.
function makeStore() {
  const rows = new Map<string, string>(); // externalId -> pl_key
  let createCalls = 0;
  const audit: ProvisionAuditEvent[] = [];
  const deps: ProvisionDeps = {
    getByExternalId: async (id) => {
      await Promise.resolve();
      const k = rows.get(id);
      return k ? { pl_key: k } : null;
    },
    createAccount: async (id) => {
      await Promise.resolve();
      createCalls++;
      if (rows.has(id)) return null; // unique-index violation
      const key = `pl_prov_${id}_${createCalls}`;
      rows.set(id, key);
      return { pl_key: key };
    },
    audit: (e) => audit.push(e),
  };
  return {
    deps,
    rows,
    audit,
    get createCalls() {
      return createCalls;
    },
  };
}

test("first provision creates a pl_ account keyed on external id", async () => {
  const s = makeStore();
  const out = await provisionAccountCore({ externalUserId: USER, email: EMAIL }, s.deps);
  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.equal(out.alreadyExisted, false);
  assert.ok(out.key.startsWith("pl_prov_"));
  assert.equal(s.createCalls, 1);
  assert.equal(s.rows.get(USER), out.key);
  assert.deepEqual(
    s.audit.map((e) => e.event),
    ["provisioned"],
  );
});

test("immediate retry is idempotent: same key, no second create", async () => {
  const s = makeStore();
  const first = await provisionAccountCore({ externalUserId: USER, email: EMAIL }, s.deps);
  const second = await provisionAccountCore({ externalUserId: USER, email: EMAIL }, s.deps);
  assert.equal(first.kind, "ok");
  assert.equal(second.kind, "ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;
  assert.equal(first.key, second.key);
  assert.equal(second.alreadyExisted, true);
  assert.equal(s.createCalls, 1, "must not create a second account");
});

test("concurrent duplicate requests converge on one account/key", async () => {
  const s = makeStore();
  const [a, b] = await Promise.all([
    provisionAccountCore({ externalUserId: USER, email: EMAIL }, s.deps),
    provisionAccountCore({ externalUserId: USER, email: EMAIL }, s.deps),
  ]);
  assert.equal(a.kind, "ok");
  assert.equal(b.kind, "ok");
  if (a.kind !== "ok" || b.kind !== "ok") return;
  assert.equal(a.key, b.key, "both callers get the same key");
  assert.equal(s.rows.size, 1, "exactly one account row exists");
});

test("email is never the idempotency key: same user, different email → same account", async () => {
  const s = makeStore();
  const first = await provisionAccountCore(
    { externalUserId: USER, email: "old@example.com" },
    s.deps,
  );
  const second = await provisionAccountCore(
    { externalUserId: USER, email: "totally-different@example.com" },
    s.deps,
  );
  assert.equal(first.kind, "ok");
  assert.equal(second.kind, "ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;
  assert.equal(first.key, second.key);
  assert.equal(s.createCalls, 1);
});

test("rate-limited requests short-circuit with retryAfterMs and no create", async () => {
  const s = makeStore();
  const deps: ProvisionDeps = {
    ...s.deps,
    rateLimit: async () => ({ ok: false, retryAfterMs: 4200 }),
  };
  const out = await provisionAccountCore({ externalUserId: USER, email: EMAIL }, deps);
  assert.equal(out.kind, "rate_limited");
  if (out.kind !== "rate_limited") return;
  assert.equal(out.retryAfterMs, 4200);
  assert.equal(s.createCalls, 0);
  assert.deepEqual(
    s.audit.map((e) => e.event),
    ["rate_limited"],
  );
});

test("genuine create failure (no existing row) surfaces as error", async () => {
  const audit: ProvisionAuditEvent[] = [];
  const deps: ProvisionDeps = {
    getByExternalId: async () => null, // never exists
    createAccount: async () => null, // always fails
    audit: (e) => audit.push(e),
  };
  const out = await provisionAccountCore({ externalUserId: USER, email: EMAIL }, deps);
  assert.equal(out.kind, "error");
  assert.deepEqual(
    audit.map((e) => e.event),
    ["error"],
  );
});

test("partial-failure retry: create returns null but a row now exists → success", async () => {
  // Emulates: a prior call created the row, then the current create hits the
  // unique index and returns null; the re-check must converge, not error.
  let existing: string | null = null;
  const deps: ProvisionDeps = {
    getByExternalId: async () => (existing ? { pl_key: existing } : null),
    createAccount: async () => {
      // Simulate the row having appeared concurrently right before our insert.
      existing = "pl_prov_raced_key";
      return null; // our insert loses the unique-index race
    },
    audit: () => {},
  };
  const out = await provisionAccountCore({ externalUserId: USER, email: EMAIL }, deps);
  assert.equal(out.kind, "ok");
  if (out.kind !== "ok") return;
  assert.equal(out.key, "pl_prov_raced_key");
  assert.equal(out.alreadyExisted, true);
});
