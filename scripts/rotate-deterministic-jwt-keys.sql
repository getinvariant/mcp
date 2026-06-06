-- ─────────────────────────────────────────────────────────────────────────────
-- rotate-deterministic-jwt-keys.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose: rotate any pl_key created by the old api/signup.ts logic that
-- derived the key deterministically from the Auth0 sub:
--
--   pl_jwt_${sub.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}
--
-- Auth0 `sub` claims are not secrets — they appear in JWT payloads, server
-- logs, and support tickets. Anyone who saw a sub could forge the matching
-- pl_key and bypass JWT auth via the x-pl-key header (lib/auth.ts accepts
-- both as peers). Code is fixed (CSPRNG via randomBytes(24)); this script
-- patches the existing rows.
--
-- HOW TO RUN:
--   1. Supabase dashboard → SQL Editor
--   2. Run STEP 1 to see how many rows are affected
--   3. Run STEP 2 to rotate them — auth0_sub stays intact so users keep
--      logging in via JWT, only the bypass surface is closed
--   4. Run STEP 3 to verify no deterministic keys remain
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1: PREVIEW ──────────────────────────────────────────────────────────
select count(*) as deterministic_jwt_keys
  from accounts
 where pl_key like 'pl_jwt_%'
   and pl_key !~ '^pl_jwt_[0-9a-f]{48}$';   -- new format is 48-hex chars

-- ── STEP 2: ROTATE ───────────────────────────────────────────────────────────
-- pgcrypto's gen_random_bytes returns bytea; encode to hex for the suffix.
-- Requires the pgcrypto extension (enabled by default on Supabase).

begin;

update accounts
   set pl_key = 'pl_jwt_' || encode(gen_random_bytes(24), 'hex')
 where pl_key like 'pl_jwt_%'
   and pl_key !~ '^pl_jwt_[0-9a-f]{48}$';

commit;

-- ── STEP 3: VERIFY ───────────────────────────────────────────────────────────
-- Should return 0.
select count(*) as remaining_weak_keys
  from accounts
 where pl_key like 'pl_jwt_%'
   and pl_key !~ '^pl_jwt_[0-9a-f]{48}$';
