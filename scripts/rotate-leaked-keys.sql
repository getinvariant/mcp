-- ─────────────────────────────────────────────────────────────────────────────
-- rotate-leaked-keys.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose: revoke all API keys exposed by the 2026-04-07 git history leak
-- (hackathon_keys.csv committed in 456c936) plus the keys later shared in
-- WhatsApp and the migration.sql demo seed.
--
-- HOW TO RUN:
--   1. Open Supabase dashboard → SQL Editor
--   2. Paste this entire file
--   3. Run the SELECT block first to confirm row count
--   4. Run the DELETE block only after the count matches expectations
--   5. Run the verification SELECT at the end — it should return 0 rows
--
-- This script is idempotent: safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1: PREVIEW (run first, sanity check) ────────────────────────────────
-- This should return the rows about to be deleted. Expect up to 43 rows
-- (41 hackathon keys + pl_demo_key_2026 + pl_f4bae5c23e198945bcdc09a1).

select id, pl_key, email, tier, created_at
from accounts
where pl_key in (
  -- 41 keys from hackathon_keys.csv (commit 456c936)
  'pl_40oc6cho7ey467td','pl_dt3fdinqu4ypk6zr','pl_9ad4oq2ebv7tylqq',
  'pl_54kkiok2qnl1oqcm','pl_mawy4h70dh31o2zm','pl_4h3wk73dgkq8wd23',
  'pl_u6opo3prmfn3wnvv','pl_wn57pdzw7alxaq75','pl_ooo2pcum1guxfvpw',
  'pl_28gyijt02685dwh1','pl_mx6fqgrsdi9xf99f','pl_lnrwhkjl5r4v8s94',
  'pl_91vr9m89qkjmoc5j','pl_dlhhv6qfbu4xghz5','pl_hr972ose4s0pih6i',
  'pl_sv4t8mr0ejft1jh6','pl_a85u6kpmqevdif85','pl_svm76ujn7ra46akb',
  'pl_7tzvrbk9ubqde8so','pl_3spcpcay9acefuai','pl_xo9nk6gunx029dfp',
  'pl_3lhfmjmmv505vado','pl_xfpp7k3ceobrzh1f','pl_2wi6wj6dcob6cqxe',
  'pl_xukaufekej0ys0rf','pl_ee350ulqm494ioft','pl_lnxvu4hiwh356brp',
  'pl_ba2ht7oujjmblp30','pl_vzoxq80xlehahfqb','pl_5zi2h4q61s5kaw07',
  'pl_fgaxzdnua7svqoxj','pl_f8xtsztwaouya53a','pl_pz8p8zq46xnkjq52',
  'pl_z3xxh1km3kiai5av','pl_95nzn0qqeugc04ca','pl_j0jocg9nkx6t8npn',
  'pl_dv45roa1mjevd2nx','pl_nh9l7jaoby05jbol','pl_npmoa3j3mwbocraj',
  'pl_uuqh06splj34mtxd',
  -- migration.sql:32 demo seed (now removed from migration as of phase 0)
  'pl_demo_key_2026',
  -- shared in team chat 2026-04-07 11:18 AM
  'pl_f4bae5c23e198945bcdc09a1'
);

-- ── STEP 2: DELETE (run only after preview matches expectations) ─────────────
-- Wrapped in a transaction so you can rollback if anything looks wrong.

begin;

-- First clean up any usage_log / monthly_usage rows that reference these
-- accounts (FK cascade would also work, but explicit is safer):
delete from monthly_usage
where account_id in (
  select id from accounts where pl_key in (
    'pl_40oc6cho7ey467td','pl_dt3fdinqu4ypk6zr','pl_9ad4oq2ebv7tylqq',
    'pl_54kkiok2qnl1oqcm','pl_mawy4h70dh31o2zm','pl_4h3wk73dgkq8wd23',
    'pl_u6opo3prmfn3wnvv','pl_wn57pdzw7alxaq75','pl_ooo2pcum1guxfvpw',
    'pl_28gyijt02685dwh1','pl_mx6fqgrsdi9xf99f','pl_lnrwhkjl5r4v8s94',
    'pl_91vr9m89qkjmoc5j','pl_dlhhv6qfbu4xghz5','pl_hr972ose4s0pih6i',
    'pl_sv4t8mr0ejft1jh6','pl_a85u6kpmqevdif85','pl_svm76ujn7ra46akb',
    'pl_7tzvrbk9ubqde8so','pl_3spcpcay9acefuai','pl_xo9nk6gunx029dfp',
    'pl_3lhfmjmmv505vado','pl_xfpp7k3ceobrzh1f','pl_2wi6wj6dcob6cqxe',
    'pl_xukaufekej0ys0rf','pl_ee350ulqm494ioft','pl_lnxvu4hiwh356brp',
    'pl_ba2ht7oujjmblp30','pl_vzoxq80xlehahfqb','pl_5zi2h4q61s5kaw07',
    'pl_fgaxzdnua7svqoxj','pl_f8xtsztwaouya53a','pl_pz8p8zq46xnkjq52',
    'pl_z3xxh1km3kiai5av','pl_95nzn0qqeugc04ca','pl_j0jocg9nkx6t8npn',
    'pl_dv45roa1mjevd2nx','pl_nh9l7jaoby05jbol','pl_npmoa3j3mwbocraj',
    'pl_uuqh06splj34mtxd','pl_demo_key_2026','pl_f4bae5c23e198945bcdc09a1'
  )
);

delete from usage_log
where account_id in (
  select id from accounts where pl_key in (
    'pl_40oc6cho7ey467td','pl_dt3fdinqu4ypk6zr','pl_9ad4oq2ebv7tylqq',
    'pl_54kkiok2qnl1oqcm','pl_mawy4h70dh31o2zm','pl_4h3wk73dgkq8wd23',
    'pl_u6opo3prmfn3wnvv','pl_wn57pdzw7alxaq75','pl_ooo2pcum1guxfvpw',
    'pl_28gyijt02685dwh1','pl_mx6fqgrsdi9xf99f','pl_lnrwhkjl5r4v8s94',
    'pl_91vr9m89qkjmoc5j','pl_dlhhv6qfbu4xghz5','pl_hr972ose4s0pih6i',
    'pl_sv4t8mr0ejft1jh6','pl_a85u6kpmqevdif85','pl_svm76ujn7ra46akb',
    'pl_7tzvrbk9ubqde8so','pl_3spcpcay9acefuai','pl_xo9nk6gunx029dfp',
    'pl_3lhfmjmmv505vado','pl_xfpp7k3ceobrzh1f','pl_2wi6wj6dcob6cqxe',
    'pl_xukaufekej0ys0rf','pl_ee350ulqm494ioft','pl_lnxvu4hiwh356brp',
    'pl_ba2ht7oujjmblp30','pl_vzoxq80xlehahfqb','pl_5zi2h4q61s5kaw07',
    'pl_fgaxzdnua7svqoxj','pl_f8xtsztwaouya53a','pl_pz8p8zq46xnkjq52',
    'pl_z3xxh1km3kiai5av','pl_95nzn0qqeugc04ca','pl_j0jocg9nkx6t8npn',
    'pl_dv45roa1mjevd2nx','pl_nh9l7jaoby05jbol','pl_npmoa3j3mwbocraj',
    'pl_uuqh06splj34mtxd','pl_demo_key_2026','pl_f4bae5c23e198945bcdc09a1'
  )
);

-- Now revoke the accounts themselves:
delete from accounts where pl_key in (
  'pl_40oc6cho7ey467td','pl_dt3fdinqu4ypk6zr','pl_9ad4oq2ebv7tylqq',
  'pl_54kkiok2qnl1oqcm','pl_mawy4h70dh31o2zm','pl_4h3wk73dgkq8wd23',
  'pl_u6opo3prmfn3wnvv','pl_wn57pdzw7alxaq75','pl_ooo2pcum1guxfvpw',
  'pl_28gyijt02685dwh1','pl_mx6fqgrsdi9xf99f','pl_lnrwhkjl5r4v8s94',
  'pl_91vr9m89qkjmoc5j','pl_dlhhv6qfbu4xghz5','pl_hr972ose4s0pih6i',
  'pl_sv4t8mr0ejft1jh6','pl_a85u6kpmqevdif85','pl_svm76ujn7ra46akb',
  'pl_7tzvrbk9ubqde8so','pl_3spcpcay9acefuai','pl_xo9nk6gunx029dfp',
  'pl_3lhfmjmmv505vado','pl_xfpp7k3ceobrzh1f','pl_2wi6wj6dcob6cqxe',
  'pl_xukaufekej0ys0rf','pl_ee350ulqm494ioft','pl_lnxvu4hiwh356brp',
  'pl_ba2ht7oujjmblp30','pl_vzoxq80xlehahfqb','pl_5zi2h4q61s5kaw07',
  'pl_fgaxzdnua7svqoxj','pl_f8xtsztwaouya53a','pl_pz8p8zq46xnkjq52',
  'pl_z3xxh1km3kiai5av','pl_95nzn0qqeugc04ca','pl_j0jocg9nkx6t8npn',
  'pl_dv45roa1mjevd2nx','pl_nh9l7jaoby05jbol','pl_npmoa3j3mwbocraj',
  'pl_uuqh06splj34mtxd','pl_demo_key_2026','pl_f4bae5c23e198945bcdc09a1'
);

-- If everything looks right, COMMIT. Otherwise ROLLBACK.
commit;

-- ── STEP 3: VERIFICATION (run after commit) ──────────────────────────────────
-- This should return 0 rows. If it returns anything, something went wrong.

select pl_key from accounts where pl_key in (
  'pl_40oc6cho7ey467td','pl_dt3fdinqu4ypk6zr','pl_demo_key_2026',
  'pl_f4bae5c23e198945bcdc09a1'
  -- (sample check; the full list above is also valid)
);
