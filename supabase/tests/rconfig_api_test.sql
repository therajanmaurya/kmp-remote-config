-- rconfig_api — the single authorized entry point for token-bearing clients.
--
-- Why this exists: the MCP server used to hold a SERVICE-ROLE key and enforce the token's scope
-- in its own process. Three things were wrong with that. The machine running it held a
-- credential that bypasses every RLS policy; a bug in the server's `gate()` meant no
-- enforcement at all; and because identity was memoised per process, a revoked token kept
-- working until the next restart.
--
-- Every call now passes through ONE funnel that verifies the token, checks the permission and
-- checks the app scope before dispatching. The property that makes this permanent rather than a
-- convention is structural: an operation added to the dispatcher CANNOT skip authorization,
-- because the dispatcher authorizes before it looks at which operation was asked for.

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'api-owner@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'api-other@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app (id, owner_id, slug, display_name, platforms) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'api-alpha', 'Alpha', ARRAY['android']),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'api-beta',  'Beta',  ARRAY['android'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_member (app_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'owner')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  t_read   text; t_write text; t_scoped text; t_dead text; t_id uuid;
  v_out    jsonb;
  v_count  int;
BEGIN
  SELECT token INTO t_read   FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','read only',30,NULL,ARRAY['read']);
  SELECT token INTO t_write  FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','read write',30,NULL,ARRAY['read','write']);
  SELECT token INTO t_scoped FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','alpha only',30,
      ARRAY['00000000-0000-0000-0000-0000000000e1']::uuid[], ARRAY['read','write']);
  SELECT token, id INTO t_dead, t_id FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','doomed',30,NULL,ARRAY['read']);

  -- ── API-1 a valid read token can list its apps ────────────────────────────────
  v_out := public.rconfig_api(t_read, 'list_apps', '{}'::jsonb);
  IF jsonb_array_length(v_out -> 'data') < 2 THEN
    RAISE EXCEPTION 'FAIL API-1: list_apps returned % apps', jsonb_array_length(v_out -> 'data');
  END IF;

  -- ── API-2 a SCOPED token sees ONLY its apps ───────────────────────────────────
  -- Filtered, not merely refused on use: a client told an app exists will try to use it and be
  -- refused, which is a worse experience and leaks the app's existence.
  v_out := public.rconfig_api(t_scoped, 'list_apps', '{}'::jsonb);
  IF jsonb_array_length(v_out -> 'data') <> 1 THEN
    RAISE EXCEPTION 'FAIL API-2: a scoped token saw % apps, expected 1', jsonb_array_length(v_out -> 'data');
  END IF;
  IF (v_out -> 'data' -> 0 ->> 'id') <> '00000000-0000-0000-0000-0000000000e1' THEN
    RAISE EXCEPTION 'FAIL API-2: a scoped token saw the wrong app';
  END IF;

  -- ── API-3 a scoped token is refused on an app outside its scope ───────────────
  v_out := public.rconfig_api(t_scoped, 'list_parameters',
             jsonb_build_object('app_id','00000000-0000-0000-0000-0000000000e2'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-3: a scoped token read an app outside its scope';
  END IF;
  IF v_out ->> 'error' NOT ILIKE '%scope%' THEN
    RAISE EXCEPTION 'FAIL API-3: the refusal does not mention scope: %', v_out ->> 'error';
  END IF;

  -- ── API-4 a read-only token cannot write ──────────────────────────────────────
  v_out := public.rconfig_api(t_read, 'create_parameter', jsonb_build_object(
             'app_id','00000000-0000-0000-0000-0000000000e1','key','x','type','boolean','default_value',to_jsonb(false)));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-4: a read-only token wrote a parameter';
  END IF;
  IF v_out ->> 'error' NOT ILIKE '%write%' THEN
    RAISE EXCEPTION 'FAIL API-4: the refusal does not name the missing permission: %', v_out ->> 'error';
  END IF;
  SELECT count(*) INTO v_count FROM public.parameter WHERE key = 'x';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL API-4: the parameter was written despite the refusal';
  END IF;

  -- ── API-5 publish is its OWN permission, not implied by write ─────────────────
  -- Staging an edit and putting it in front of users are different acts.
  v_out := public.rconfig_api(t_write, 'publish', jsonb_build_object('app_id','00000000-0000-0000-0000-0000000000e1'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-5: a write token published without the publish permission';
  END IF;
  IF v_out ->> 'error' NOT ILIKE '%publish%' THEN
    RAISE EXCEPTION 'FAIL API-5: the refusal does not name publish: %', v_out ->> 'error';
  END IF;

  -- ── API-6 a write token CAN write ─────────────────────────────────────────────
  v_out := public.rconfig_api(t_write, 'create_parameter', jsonb_build_object(
             'app_id','00000000-0000-0000-0000-0000000000e1','key','api_test_flag','type','boolean',
             'default_value',to_jsonb(true),'description','written through the funnel'));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL API-6: a write token was refused: %', v_out ->> 'error';
  END IF;
  SELECT count(*) INTO v_count FROM public.parameter WHERE key = 'api_test_flag';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL API-6: the parameter was not written';
  END IF;

  -- ── API-7 REVOCATION is immediate, not next-restart ───────────────────────────
  -- The specific gap the in-process design had: identity was memoised per process, so a token
  -- revoked in the dashboard kept working until the server was restarted.
  v_out := public.rconfig_api(t_dead, 'list_apps', '{}'::jsonb);
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL API-7: a live token was refused before revocation';
  END IF;
  PERFORM public.access_token_revoke(t_id, '00000000-0000-0000-0000-0000000000d1');
  v_out := public.rconfig_api(t_dead, 'list_apps', '{}'::jsonb);
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-7: a revoked token still worked on the very next call';
  END IF;

  -- ── API-8 an unknown token is refused with ONE shape ──────────────────────────
  v_out := public.rconfig_api('rcp_' || repeat('q',40), 'list_apps', '{}'::jsonb);
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-8: an unknown token was served';
  END IF;
  -- Must not distinguish unknown from expired from revoked — that would be a probing oracle.
  IF v_out ->> 'error' ILIKE '%expired%' OR v_out ->> 'error' ILIKE '%revoked%' THEN
    RAISE EXCEPTION 'FAIL API-8: the refusal discloses WHY: %', v_out ->> 'error';
  END IF;

  -- ── API-9 an unknown OPERATION is refused AFTER authorization ─────────────────
  -- Order matters: if the dispatcher resolved the operation first, an unauthenticated caller
  -- could enumerate which operations exist by the difference in error.
  v_out := public.rconfig_api('rcp_' || repeat('q',40), 'drop_everything', '{}'::jsonb);
  IF v_out ->> 'error' ILIKE '%unknown operation%' THEN
    RAISE EXCEPTION 'FAIL API-9: an invalid token learned which operations exist';
  END IF;
  v_out := public.rconfig_api(t_read, 'drop_everything', '{}'::jsonb);
  IF v_out ->> 'error' NOT ILIKE '%unknown operation%' THEN
    RAISE EXCEPTION 'FAIL API-9: a valid token got no useful error for a bad operation: %', v_out ->> 'error';
  END IF;

  -- ── API-10 a scoped token cannot register a NEW app ───────────────────────────
  -- A scoped token is an exhaustive allowlist; creating an app would let it grant itself one.
  v_out := public.rconfig_api(t_scoped, 'onboard_app', jsonb_build_object(
             'display_name','Sneaky','bundle_id','com.example.sneaky','platforms',jsonb_build_array('android')));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-10: a scoped token registered a new app';
  END IF;

  -- ── API-11 a token cannot reach another user's app ────────────────────────────
  -- Even unscoped: "all apps" means all apps THE OWNER can reach, re-evaluated per call.
  INSERT INTO public.app (id, owner_id, slug, display_name, platforms)
  VALUES ('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-0000000000d2','api-foreign','Foreign',ARRAY['android'])
  ON CONFLICT (id) DO NOTHING;
  v_out := public.rconfig_api(t_read, 'list_parameters',
             jsonb_build_object('app_id','00000000-0000-0000-0000-0000000000e9'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL API-11: an unscoped token read another user''s app';
  END IF;

  -- ── API-12 add_override is scope-checked via its PARAMETER ───────────────────
  -- It names no app_id, so the funnel's generic scope check does not cover it. Found by the
  -- TypeScript compiler while rewiring the client: the tool's schema has no app_id field, so
  -- the one write that changes what a targeted audience receives was skipping the check.
  DECLARE
    v_param uuid; v_cond uuid;
  BEGIN
    -- a parameter + condition in app BETA, which the scoped (alpha-only) token cannot reach
    INSERT INTO public.parameter (app_id, key, type, default_value)
    VALUES ('00000000-0000-0000-0000-0000000000e2','beta_flag','boolean',to_jsonb(false))
    RETURNING id INTO v_param;
    INSERT INTO public.condition (app_id, name, predicate, priority)
    VALUES ('00000000-0000-0000-0000-0000000000e2','beta cohort','{}'::jsonb, 1)
    RETURNING id INTO v_cond;

    v_out := public.rconfig_api(t_scoped, 'add_override', jsonb_build_object(
               'parameter_id', v_param, 'condition_id', v_cond, 'value', to_jsonb(true)));
    IF v_out -> 'error' IS NULL THEN
      RAISE EXCEPTION 'FAIL API-12: a scoped token overrode a parameter outside its scope';
    END IF;
    SELECT count(*) INTO v_count FROM public.parameter_value WHERE parameter_id = v_param;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'FAIL API-12: the override was written despite the refusal';
    END IF;

    -- CONTROL for API-12: the same call with a token that CAN reach beta must SUCCEED.
    -- Without this, an add_override that always failed — a typo, a broken insert — would
    -- satisfy API-12 while proving nothing about scope.
    v_out := public.rconfig_api(t_write, 'add_override', jsonb_build_object(
               'parameter_id', v_param, 'condition_id', v_cond, 'value', to_jsonb(true)));
    IF v_out -> 'error' IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL API-12 control: an in-scope override was refused: %', v_out ->> 'error';
    END IF;
    SELECT count(*) INTO v_count FROM public.parameter_value WHERE parameter_id = v_param;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'FAIL API-12 control: the in-scope override was not written';
    END IF;

    -- ── API-13 a condition from ANOTHER app cannot be attached ─────────────────
    -- Otherwise a caller inside one app could couple it to another app's condition.
    DECLARE v_alpha_param uuid;
    BEGIN
      INSERT INTO public.parameter (app_id, key, type, default_value)
      VALUES ('00000000-0000-0000-0000-0000000000e1','alpha_flag','boolean',to_jsonb(false))
      RETURNING id INTO v_alpha_param;
      v_out := public.rconfig_api(t_write, 'add_override', jsonb_build_object(
                 'parameter_id', v_alpha_param, 'condition_id', v_cond, 'value', to_jsonb(true)));
      IF v_out -> 'error' IS NULL THEN
        RAISE EXCEPTION 'FAIL API-13: a condition from another app was attached';
      END IF;
    END;
  END;

  RAISE NOTICE 'rconfig_api: 14/14 assertions passed (13 + 1 control)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- issue_key — giving an app that already exists a key for a platform it does not have.
--
-- The gap this closes: `onboard_app` mints keys only while CREATING an app and refuses a slug it
-- has seen before, so an app registered as Android-only had NO API path to an iOS key — and
-- could not borrow the Android one, because `app_key.platform` is enforced (403
-- `platform_mismatch`). The only route left was a direct write to `app_key`, which is the
-- unscoped database access migration 017 exists to remove.
--
-- A separate DO block on purpose: the 14 assertions above describe the funnel's authorization
-- properties and should not acquire a dependency on this operation's fixtures.
-- ════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t_write text; t_read text; t_scoped text;
  v_out jsonb; v_count int; v_plats text[];
  app_beta  uuid := '00000000-0000-0000-0000-0000000000e2';
  app_alpha uuid := '00000000-0000-0000-0000-0000000000e1';
BEGIN
  SELECT token INTO t_write  FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','ik write',30,NULL,ARRAY['read','write']);
  SELECT token INTO t_read   FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','ik read',30,NULL,ARRAY['read']);
  SELECT token INTO t_scoped FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','ik alpha only',30,
      ARRAY[app_alpha]::uuid[], ARRAY['read','write']);

  -- The starting state is the one every app onboarded before its iOS build existed is in:
  -- Android-only, with a key that carries the app's bundle id.
  INSERT INTO public.app_key (app_id, key, label, environment, platform, bundle_id, attestation_policy)
  VALUES (app_beta, public.generate_publishable_key('test'), 'android test', 'test', 'android',
          'com.example.beta', 'off');

  -- ── IK-1 issuing a platform mints BOTH environments, as onboarding does ───────────────────
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', app_beta, 'platform', 'ios'));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL IK-1: %', v_out ->> 'error';
  END IF;
  IF jsonb_array_length(v_out -> 'data' -> 'keys') <> 2 THEN
    RAISE EXCEPTION 'FAIL IK-1: expected a live and a test key, got %',
      jsonb_array_length(v_out -> 'data' -> 'keys');
  END IF;

  -- ── IK-2 a test key skips attestation, a live key prefers it ──────────────────────────────
  -- Never 'required': that locks an operator out of their own first build, and it is a decision
  -- they should make deliberately rather than inherit from a default.
  SELECT count(*) INTO v_count FROM public.app_key
   WHERE app_id = app_beta AND platform = 'ios'
     AND ((environment = 'test' AND attestation_policy = 'off')
       OR (environment = 'live' AND attestation_policy = 'preferred'));
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL IK-2: attestation policy wrong on the minted ios keys (% of 2 correct)', v_count;
  END IF;

  -- ── IK-3 app.platforms is kept honest ─────────────────────────────────────────────────────
  -- list_apps and the dashboard read it. An app serving an iOS key while still describing
  -- itself as Android-only is a row that contradicts itself.
  SELECT platforms INTO v_plats FROM public.app WHERE id = app_beta;
  IF NOT (v_plats @> ARRAY['ios']) THEN
    RAISE EXCEPTION 'FAIL IK-3: app.platforms is still %', v_plats;
  END IF;

  -- ── IK-4 the bundle id is inherited from the app's existing keys ──────────────────────────
  SELECT count(*) INTO v_count FROM public.app_key
   WHERE app_id = app_beta AND platform = 'ios' AND bundle_id = 'com.example.beta';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL IK-4: bundle id was not inherited (% of 2 keys carry it)', v_count;
  END IF;

  -- ── IK-5 a repeat call is refused, and the refusal names the existing key ─────────────────
  -- Running the same command twice is a likelier explanation than a rotation meant on purpose.
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', app_beta, 'platform', 'ios'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL IK-5: a duplicate ios key was minted silently';
  END IF;
  IF v_out ->> 'error' NOT LIKE '%rotate%' THEN
    RAISE EXCEPTION 'FAIL IK-5: the refusal does not say how to proceed: %', v_out ->> 'error';
  END IF;

  -- ── IK-6 rotate:true issues another alongside the existing one ────────────────────────────
  v_out := public.rconfig_api(t_write, 'issue_key', jsonb_build_object(
             'app_id', app_beta, 'platform', 'ios', 'environment', 'test', 'rotate', true));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL IK-6: rotate was refused: %', v_out ->> 'error';
  END IF;
  SELECT count(*) INTO v_count FROM public.app_key
   WHERE app_id = app_beta AND platform = 'ios' AND environment = 'test';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL IK-6: expected 2 ios test keys after a rotation, found %', v_count;
  END IF;

  -- ── IK-7 naming an environment issues ONLY that one ───────────────────────────────────────
  v_out := public.rconfig_api(t_write, 'issue_key', jsonb_build_object(
             'app_id', app_beta, 'platform', 'web', 'environment', 'test'));
  IF jsonb_array_length(v_out -> 'data' -> 'keys') <> 1 THEN
    RAISE EXCEPTION 'FAIL IK-7: expected 1 key, got %', jsonb_array_length(v_out -> 'data' -> 'keys');
  END IF;
  SELECT count(*) INTO v_count FROM public.app_key WHERE app_id = app_beta AND platform = 'web';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL IK-7: a live web key was minted without being asked for (% rows)', v_count;
  END IF;

  -- ── IK-8 an unknown platform is refused BY NAME ───────────────────────────────────────────
  -- Left to the table's CHECK this surfaces to the operator as a 500 from the edge function
  -- with nothing actionable in it.
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', app_beta, 'platform', 'blackberry'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL IK-8: an unknown platform was accepted';
  END IF;
  IF v_out ->> 'error' NOT LIKE '%android, ios, desktop, web, wasm%' THEN
    RAISE EXCEPTION 'FAIL IK-8: the refusal does not list the valid platforms: %', v_out ->> 'error';
  END IF;

  -- ── IK-9 a read-only token cannot mint a key ──────────────────────────────────────────────
  v_out := public.rconfig_api(t_read, 'issue_key',
             jsonb_build_object('app_id', app_beta, 'platform', 'desktop'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL IK-9: a read-only token minted a key';
  END IF;

  -- ── IK-10 a scoped token cannot reach an app outside its scope ────────────────────────────
  v_out := public.rconfig_api(t_scoped, 'issue_key',
             jsonb_build_object('app_id', app_beta, 'platform', 'desktop'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL IK-10: a scoped token issued a key for an app outside its scope';
  END IF;

  -- ── IK-10 control — the same token CAN issue for the app it is scoped to ──────────────────
  -- Without this, IK-9 and IK-10 would both pass if issue_key were simply broken for everyone.
  v_out := public.rconfig_api(t_scoped, 'issue_key',
             jsonb_build_object('app_id', app_alpha, 'platform', 'desktop'));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL IK-10 control: the in-scope issue was refused: %', v_out ->> 'error';
  END IF;

  RAISE NOTICE 'issue_key: 11/11 assertions passed (10 + 1 control)';
END $$;


ROLLBACK;
