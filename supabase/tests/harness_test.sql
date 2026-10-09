-- Proves the hardening POSTURE actually took effect, rather than trusting that
-- migration 001 ran. With anon/authenticated revoked at the SCHEMA level, a table
-- whose RLS policy we forgot is unreachable rather than world-readable — so this
-- assertion is the floor every later table's security rests on.
DO $$
BEGIN
  IF has_schema_privilege('anon', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: anon still has USAGE on schema public';
  END IF;

  -- Only `anon` is asserted here. `authenticated` deliberately HAS schema USAGE (001
  -- grants it back so RLS policies can evaluate) and, after 002-006, legitimately holds
  -- per-table grants — so there is no blanket "no grants" claim to make about it. Its
  -- boundary is the POLICIES, and rls_test.sql is what proves those.
  IF EXISTS (
    SELECT 1
      FROM information_schema.role_table_grants
     WHERE grantee IN ('anon')
       AND table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'FAIL: anon holds table grants in schema public';
  END IF;

  -- I5 end-state assertion. anon must not be able to EXECUTE ANY routine in public.
  -- Checked on the real functions rather than on a throwaway one, because Supabase's own
  -- pg_default_acl row (grantor supabase_admin) re-grants EXECUTE to anon/authenticated on
  -- newly created functions and `postgres` cannot revoke another grantor's defaults. 007
  -- sweeps the end state instead; this proves the sweep actually held.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'FAIL: anon can EXECUTE % routine(s) in public',
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE'));
  END IF;

  -- `authenticated` is limited to the exact allowlist 007 grants, plus routines a later
  -- migration adds DELIBERATELY with their own REVOKE/GRANT pair. A new routine that
  -- forgets that pair shows up here rather than shipping callable — proven twice while
  -- building 008 and 009, each of which failed this assertion by name before the pair was
  -- added.
  --
  --   fork_template (009) — adopting a community template is a dashboard action, so the
  --   operator role must call it. It is SECURITY DEFINER and checks has_app_role on the
  --   DESTINATION app itself, which is stricter than the table policies alone.
  --
  -- The allowlist is the set authenticated LEGITIMATELY needs, and it is maintained by hand on
  -- purpose: adding a row should require saying why. It went stale once — migrations 011-015
  -- added publish/rollback_to/resolve_* without updating it, and this assertion stayed red and
  -- unseen because the anon check above short-circuits first. Anything NOT listed here is
  -- reachable only through a SECURITY DEFINER caller, so the invoking role needs no grant.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.proname NOT IN (
         -- RLS policy expressions — evaluated in the caller's context, so authenticated needs them
         'is_app_member','has_app_role',
         -- the dashboard calls these directly as the signed-in operator
         'generate_publishable_key','fork_template',
         'publish','rollback_to','resolve_parameters','resolve_parameter_explain',
         'access_token_create','access_token_revoke'
       )
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated can EXECUTE a routine outside the allowlist: %',
      (SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND p.proname NOT IN (
         -- RLS policy expressions — evaluated in the caller's context, so authenticated needs them
         'is_app_member','has_app_role',
         -- the dashboard calls these directly as the signed-in operator
         'generate_publishable_key','fork_template',
         'publish','rollback_to','resolve_parameters','resolve_parameter_explain',
         'access_token_create','access_token_revoke'
       ));
  END IF;

  RAISE NOTICE 'PASS: anon closed out of schema public; routine grants match the allowlist';
END $$;
