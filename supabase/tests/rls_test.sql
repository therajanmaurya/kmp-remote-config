-- Cross-tenant isolation. A policy bug here is a data leak between customers, and it
-- will not show up in any single-user manual test. This file adds no schema; it proves it.
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111','a@example.test'),
  ('22222222-2222-2222-2222-222222222222','b@example.test'),
  ('33333333-3333-3333-3333-333333333333','viewer@example.test');

INSERT INTO public.app (id, owner_id, slug, display_name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','app-a','App A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','app-b','App B');
INSERT INTO public.app_member (app_id, user_id, role)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','33333333-3333-3333-3333-333333333333','viewer');
INSERT INTO public.app_key (app_id, key, environment)
VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', public.generate_publishable_key('live'), 'live');
INSERT INTO public.config (id, app_id, template_id, payload, display)
VALUES ('cccccccc-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-00000000000b',
        'announcement','{"title":"t","body":"b"}','dialog');

-- Impersonation helper: `set local role` + request.jwt.claims is how Supabase's auth.uid()
-- resolves inside a transaction.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'set local role authenticated';
  EXECUTE format('set local request.jwt.claims = %L', json_build_object('sub', p_uid)::text);
END $$;

DO $$
DECLARE n int; n_app uuid;
BEGIN
  -- ── user A must not see user B's anything ────────────────────────────────
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');

  SELECT count(*) INTO n FROM public.app WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: user A can SELECT user B''s app'; END IF;

  SELECT count(*) INTO n FROM public.app_key WHERE app_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: user A can SELECT user B''s app_key'; END IF;

  SELECT count(*) INTO n FROM public.config WHERE app_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: user A can SELECT user B''s config'; END IF;

  -- …and must not write into B's app
  BEGIN
    INSERT INTO public.config (app_id, template_id, payload, display)
    VALUES ('bbbbbbbb-0000-0000-0000-00000000000b','announcement','{"title":"x","body":"y"}','dialog');
    RAISE EXCEPTION 'FAIL: user A inserted a config into user B''s app';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ── a viewer may read but not write ──────────────────────────────────────
  PERFORM pg_temp.as_user('33333333-3333-3333-3333-333333333333');

  SELECT count(*) INTO n FROM public.app WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: viewer cannot read the app they belong to'; END IF;

  BEGIN
    INSERT INTO public.config (app_id, template_id, payload, display)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a','announcement','{"title":"x","body":"y"}','dialog');
    RAISE EXCEPTION 'FAIL: viewer wrote a config';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- …and may not grant themselves a role
  UPDATE public.app_member SET role = 'owner'
   WHERE app_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     AND user_id = '33333333-3333-3333-3333-333333333333';
  IF (SELECT role FROM public.app_member
       WHERE app_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
         AND user_id = '33333333-3333-3333-3333-333333333333') <> 'viewer' THEN
    RAISE EXCEPTION 'FAIL: viewer escalated their own role';
  END IF;

  -- ── NOBODY authenticated may touch impression ────────────────────────────
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  BEGIN
    SELECT count(*) INTO n FROM public.impression;
    RAISE EXCEPTION 'FAIL: authenticated can SELECT impression';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ── POSITIVE PATH: the intended user must be ALLOWED ────────────────────
  -- The suite's systematic blind spot (found in review): every fixture above is seeded as
  -- `postgres`, which has BYPASSRLS, so the tests prove WHO IS DENIED and never prove that
  -- an operator can do their job. App creation as `authenticated` is the dashboard's actual
  -- path, and it was broken by two independent policy bugs that no negative test could see.
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');

  -- Plain INSERT must succeed: the owner-membership trigger writes to app_member, whose
  -- write policy demands owner role on an app that has no members yet (bootstrap paradox).
  INSERT INTO public.app (owner_id, slug, display_name)
  VALUES ('11111111-1111-1111-1111-111111111111','fresh-app','Fresh');

  -- INSERT ... RETURNING must ALSO succeed. RETURNING requires the SELECT policy to pass
  -- for the new row, and membership is created by an AFTER trigger — so a policy keyed only
  -- on membership fails here. PostgREST/supabase-js ALWAYS use RETURNING, so this is the
  -- dashboard's real call, not a corner case.
  INSERT INTO public.app (owner_id, slug, display_name)
  VALUES ('11111111-1111-1111-1111-111111111111','fresh-app-2','Fresh 2')
  RETURNING id INTO STRICT n_app;

  -- the trigger's membership row must be visible to its owner
  SELECT count(*) INTO n FROM public.app_member
   WHERE app_id = n_app AND user_id = '11111111-1111-1111-1111-111111111111' AND role = 'owner';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: owner membership not created/visible for a self-created app'; END IF;

  -- and the owner can then author a config in it
  INSERT INTO public.config (app_id, template_id, payload, display)
  VALUES (n_app, 'announcement', '{"title":"ok","body":"ok"}', 'dialog');

  RESET ROLE;
  RAISE NOTICE 'PASS: cross-tenant isolation holds + operator can create and author';
END $$;
ROLLBACK;
