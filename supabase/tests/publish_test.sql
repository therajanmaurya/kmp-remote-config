-- Phase 02 / T1+T3 — the publish gate.
--
-- The safety gap this closes: today every edit is live on the next fetch. There is no staging,
-- no review, and no way back — `config.version` increments but no prior content is retained, so
-- "what was live on Tuesday" has no answer and a bad change can only be fixed by editing
-- forwards under time pressure. A configuration change is a deploy; it needs a deploy's gate.
--
-- Runs inside a transaction and ROLLBACKs, so it is safe against the deployed project.
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-1111111111bb','pub@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000bb','11111111-1111-1111-1111-1111111111bb','app-pub','App Publish');

-- Impersonation helper, matching rls_test.sql: `set local role` + request.jwt.claims is how
-- Supabase's auth.uid() resolves inside a transaction. publish() and rollback_to() are
-- SECURITY DEFINER and check membership explicitly, so running them as the superuser (where
-- auth.uid() is NULL) is correctly REFUSED — the test has to act as a real member.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'set local role authenticated';
  EXECUTE format('set local request.jwt.claims = %L', json_build_object('sub', p_uid)::text);
END $$;

DO $$
DECLARE
  app   uuid := 'aaaaaaaa-0000-0000-0000-0000000000bb';
  usr   text := '11111111-1111-1111-1111-1111111111bb';
  cid   uuid;
  v1    int;
  v2    int;
  v3    int;
  n     int;
  c1    jsonb;
  c3    jsonb;
BEGIN
  INSERT INTO public.config (app_id, template_id, payload, display, is_enabled)
  VALUES (app, 'announcement', '{"title":"original","body":"v1 body"}', 'dialog', true)
  RETURNING id INTO cid;

  PERFORM pg_temp.as_user(usr);

  -- (b) publish() creates exactly one version whose content equals the current drafts.
  SELECT public.publish(app) INTO v1;
  SELECT count(*) INTO n FROM public.config_version WHERE app_id = app;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: publish() produced % versions, expected 1', n; END IF;
  SELECT content INTO c1 FROM public.config_version WHERE app_id = app AND version = v1;
  IF c1::text NOT LIKE '%original%' THEN
    RAISE EXCEPTION 'FAIL: published snapshot does not contain the draft content';
  END IF;

  -- (a) editing a config does NOT change the latest version. This is the whole safety gate:
  -- an edit must be invisible to devices until someone presses Publish.
  UPDATE public.config SET payload = '{"title":"edited","body":"not published"}' WHERE id = cid;
  SELECT content INTO c3 FROM public.config_version WHERE app_id = app AND version = v1;
  IF c3::text LIKE '%edited%' THEN
    RAISE EXCEPTION 'FAIL: an unpublished edit leaked into the published snapshot';
  END IF;
  SELECT count(*) INTO n FROM public.config_version WHERE app_id = app;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: editing a draft created a version (got %)', n; END IF;

  -- (c) a published version is immutable. History that can be rewritten is not an audit trail.
  -- Deliberately as the SUPERUSER: a REVOKE would not bind this role, so proving the refusal
  -- here is what shows the guarantee comes from the trigger rather than from a privilege.
  RESET ROLE;
  BEGIN
    UPDATE public.config_version SET content = '{"tampered":true}' WHERE app_id = app AND version = v1;
    RAISE EXCEPTION 'FAIL: a published version row accepted an UPDATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.config_version WHERE app_id = app AND version = v1;
    RAISE EXCEPTION 'FAIL: a published version row accepted a DELETE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.as_user(usr);

  -- T3 — rollback is a NEW version, never a deletion.
  SELECT public.publish(app) INTO v2;                      -- v2 carries "edited"
  SELECT public.rollback_to(app, v1) INTO v3;              -- v3 must re-publish v1's content

  SELECT count(*) INTO n FROM public.config_version WHERE app_id = app;
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected 3 versions after publish/publish/rollback, got %', n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.config_version WHERE app_id = app AND version = v2) THEN
    RAISE EXCEPTION 'FAIL: rollback deleted v2 — the mistake must stay in the record';
  END IF;

  SELECT content INTO c1 FROM public.config_version WHERE app_id = app AND version = v1;
  SELECT content INTO c3 FROM public.config_version WHERE app_id = app AND version = v3;
  IF c1 <> c3 THEN
    RAISE EXCEPTION 'FAIL: rollback content differs from the version it restored';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS: publish gate, snapshot immutability and rollback-as-new-version hold';
END $$;

ROLLBACK;
