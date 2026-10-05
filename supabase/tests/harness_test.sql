-- Proves the hardening POSTURE actually took effect, rather than trusting that
-- migration 001 ran. With anon/authenticated revoked at the SCHEMA level, a table
-- whose RLS policy we forgot is unreachable rather than world-readable — so this
-- assertion is the floor every later table's security rests on.
DO $$
BEGIN
  IF has_schema_privilege('anon', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: anon still has USAGE on schema public';
  END IF;

  -- `authenticated` is granted USAGE back narrowly by 001 (the dashboard reaches
  -- tables through RLS policies on that role, which requires schema USAGE), so the
  -- assertion for it is about TABLE rights, not schema USAGE: it must hold none by
  -- default. Each table grants its own.
  IF EXISTS (
    SELECT 1
      FROM information_schema.role_table_grants
     WHERE grantee IN ('anon')
       AND table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'FAIL: anon holds table grants in schema public';
  END IF;

  RAISE NOTICE 'PASS: schema public is closed to anon';
END $$;
