-- ============================================================
-- Final routine-grant sweep. Runs LAST, after every function exists.
--
-- WHY A SWEEP RATHER THAN DEFAULT PRIVILEGES:
-- 001 revokes default EXECUTE on functions, but default privileges are stored PER GRANTOR
-- and only the grantor can revoke its own. Measured on a fresh stack, pg_default_acl holds
-- TWO rows for (public, function):
--
--   grantor postgres        → {postgres=X, service_role=X}            ← 001's revoke applies here
--   grantor supabase_admin  → {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- `postgres` is not a member of `supabase_admin`, so migration 001 cannot touch the second
-- row. The observable result is that a brand-new function in `public` still lands with
-- `=X/postgres` in its ACL — an EMPTY GRANTEE, which is the PUBLIC pseudo-role, exactly the
-- inheritance hole that made 001's first draft a silent no-op. anon then has EXECUTE by
-- inheritance even though no grant names it.
--
-- So the posture is enforced on the END STATE instead of on the defaults: revoke from
-- everything, then re-grant precisely what each trust path needs. Deterministic, and it does
-- not depend on which role authored a default-ACL row.
--
-- ⚠ A FUNCTION ADDED IN A LATER MIGRATION IS NOT COVERED BY THIS SWEEP — it already ran.
-- Any new routine in `public` must carry its own REVOKE/GRANT pair, and harness_test.sql
-- asserts the end state so an unguarded addition fails the suite rather than shipping
-- callable by every signed-in operator.
-- ============================================================

REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- The dashboard's two RLS predicates: `authenticated` must call these or every policy
-- fails closed and the UI shows "no apps" rather than a permission error.
GRANT EXECUTE ON FUNCTION public.is_app_member(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_role(uuid, text[]) TO authenticated;

-- Key minting is a dashboard action, so the operator role needs it.
GRANT EXECUTE ON FUNCTION public.generate_publishable_key(text) TO authenticated;

-- The Edge Function write path only. Never `authenticated`: the dashboard has no business
-- writing impression rows, and `anon` is on no trust path at all.
GRANT EXECUTE ON FUNCTION public.record_event(uuid, uuid, text, text, text) TO service_role;

-- Trigger functions are invoked by the engine, not called by a role, so they stay revoked:
--   touch_updated_at · app_owner_membership · config_template_coherence
