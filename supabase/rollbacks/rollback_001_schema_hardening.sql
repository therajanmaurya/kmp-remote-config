-- Rollback of 001_schema_hardening.
--
-- ⚠ LOCAL EXPERIMENTATION ONLY. Running this against the DEPLOYED project re-opens
-- every table in `public` to the anon key — which is the exact posture the control
-- plane exists to avoid. There is no situation in which a deployed rconfig project
-- should have this applied; if the hardening needs changing, write a forward migration.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
