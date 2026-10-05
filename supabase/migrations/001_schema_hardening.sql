-- ============================================================
-- Schema hardening. This is the POSTURE every later migration relies on:
-- with anon revoked at the SCHEMA level, a table whose RLS policy we forgot is
-- unreachable rather than world-readable. Adopted from the reels-downloader
-- 013_rls_hardening.sql posture.
--
-- Two trust paths reach this database and the split is the core security property:
--   dashboard → the signed-in user's JWT → RLS decides        (role: authenticated)
--   SDK       → Edge Function → service_role → RLS bypassed   (the function IS the boundary)
-- `anon` is on neither path and therefore gets nothing.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), gen_random_bytes()

-- FROM PUBLIC, not just FROM anon. Schema `public` ships with USAGE granted to the
-- PUBLIC pseudo-role (visible as the `=U/pg_database_owner` entry in pg_namespace.nspacl,
-- where an empty grantee means PUBLIC). Every role INHERITS from PUBLIC, so revoking
-- anon's direct grant alone leaves `has_schema_privilege('anon','public','USAGE')` true
-- and the schema wide open. Omitting PUBLIC here is a revoke that runs clean, reports
-- nothing, and hardens nothing.
REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Routines default to EXECUTE for PUBLIC too, which would leave the SECURITY DEFINER
-- helpers (is_app_member, record_event) callable by any role that reaches the schema.
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Future objects too: without this, the next CREATE TABLE or CREATE FUNCTION re-grants by
-- default and the hardening silently decays as the schema grows.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Grant USAGE back to exactly the roles on a real trust path, and nothing else:
--   postgres / service_role — the Edge Functions' path (RLS bypassed, function is the boundary)
--   authenticated           — the dashboard's path; an RLS policy cannot evaluate without
--                             schema USAGE. Granted WITHOUT any table rights, so each table
--                             grants its own and a new table is unreachable until it
--                             deliberately opens itself.
-- `anon` is granted nothing: nothing in this product authenticates as anon.
GRANT USAGE ON SCHEMA public TO postgres, service_role, authenticated;
