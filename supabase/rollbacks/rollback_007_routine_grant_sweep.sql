-- Rollback of 007. LOCAL EXPERIMENTATION ONLY — re-opens EXECUTE on every routine in
-- public to the PUBLIC pseudo-role, which anon inherits.
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO PUBLIC;
