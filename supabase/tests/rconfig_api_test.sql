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


-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Config authoring — list_configs / create_config / update_config.
--
-- Before these, `rconfig_api` had no config operation AT ALL. The dashboard authors configs over
-- PostgREST as the signed-in user, so the gap was invisible from there: the funnel is the
-- agent/MCP path, and from it the product's central object could not be created, read or edited.
-- The sample app's configs came from `seed_demo.sql` — a direct SQL seed — which is why they
-- carried copy describing the TEMPLATE rather than anything a user should read.
-- ════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t_write text; t_read text; t_scoped text;
  v_out jsonb; v_cfg uuid; v_count int; v_txt text; v_bool boolean; v_arr text[];
  app_beta  uuid := '00000000-0000-0000-0000-0000000000e2';
  app_alpha uuid := '00000000-0000-0000-0000-0000000000e1';
BEGIN
  SELECT token INTO t_write  FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','cf write',30,NULL,ARRAY['read','write']);
  SELECT token INTO t_read   FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','cf read',30,NULL,ARRAY['read']);
  SELECT token INTO t_scoped FROM public.access_token_create('00000000-0000-0000-0000-0000000000d1','cf alpha only',30,
      ARRAY[app_alpha]::uuid[], ARRAY['read','write']);

  -- ── CF-1 a create with no payload adopts the template's default ──────────────────────────
  v_out := public.rconfig_api(t_write, 'create_config',
             jsonb_build_object('app_id', app_beta, 'template_id', 'announcement'));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL CF-1: %', v_out ->> 'error';
  END IF;
  v_cfg := (v_out -> 'data' ->> 'id')::uuid;
  SELECT payload ->> 'title' INTO v_txt FROM public.config WHERE id = v_cfg;
  IF v_txt IS DISTINCT FROM (SELECT default_payload ->> 'title' FROM public.template WHERE id = 'announcement') THEN
    RAISE EXCEPTION 'FAIL CF-1: the default payload was not adopted (title=%)', v_txt;
  END IF;

  -- ── CF-2 a created config is DISABLED ────────────────────────────────────────────────────
  -- The one property that keeps authoring safe. A config created live is a message shown to
  -- real users by a call that was only meant to write one down.
  SELECT is_enabled INTO v_bool FROM public.config WHERE id = v_cfg;
  IF v_bool THEN
    RAISE EXCEPTION 'FAIL CF-2: a newly created config was live';
  END IF;

  -- ── CF-3 display falls back to the template's first allowed surface ──────────────────────
  SELECT display INTO v_txt FROM public.config WHERE id = v_cfg;
  IF v_txt <> 'dialog' THEN
    RAISE EXCEPTION 'FAIL CF-3: display defaulted to %, expected dialog', v_txt;
  END IF;

  -- ── CF-4 every builtin can be created from its own default ───────────────────────────────
  -- A regression for `policy_update`: `config.is_dismissible` defaults TRUE and the coherence
  -- trigger refuses a dismissible config on a requires_ack template, so a create that merely
  -- omitted the column could not author that template at all — one of the fifteen, unreachable
  -- through its own API. Written as a loop because the next requires_ack template would
  -- reintroduce it silently.
  DECLARE r record; bad text := '';
  BEGIN
    FOR r IN SELECT id FROM public.template WHERE is_builtin ORDER BY id LOOP
      v_out := public.rconfig_api(t_write, 'create_config',
                 jsonb_build_object('app_id', app_alpha, 'template_id', r.id));
      IF v_out -> 'error' IS NOT NULL THEN
        bad := bad || r.id || ' (' || (v_out ->> 'error') || '); ';
      END IF;
    END LOOP;
    IF bad <> '' THEN
      RAISE EXCEPTION 'FAIL CF-4: builtins that cannot be created from their default: %', bad;
    END IF;
  END;

  -- ── CF-5 a disallowed display is refused, with the trigger's own message ─────────────────
  v_out := public.rconfig_api(t_write, 'create_config', jsonb_build_object(
             'app_id', app_beta, 'template_id', 'paywall_upsell', 'display', 'banner'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL CF-5: a paywall was created on a banner';
  END IF;
  IF v_out ->> 'error' NOT LIKE '%not allowed for template%' THEN
    RAISE EXCEPTION 'FAIL CF-5: the refusal lost the trigger''s explanation: %', v_out ->> 'error';
  END IF;

  -- ── CF-6 a payload that fails its schema is refused ──────────────────────────────────────
  -- The server owns renderability: a payload that cannot render must not be storable.
  v_out := public.rconfig_api(t_write, 'create_config', jsonb_build_object(
             'app_id', app_beta, 'template_id', 'announcement',
             'payload', jsonb_build_object('title', 'no body field')));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL CF-6: a payload missing a required field was stored';
  END IF;

  -- ── CF-7 an unknown template is refused ──────────────────────────────────────────────────
  v_out := public.rconfig_api(t_write, 'create_config',
             jsonb_build_object('app_id', app_beta, 'template_id', 'no_such_template'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL CF-7: an unknown template was accepted';
  END IF;

  -- ── CF-8 update_config replaces the payload ──────────────────────────────────────────────
  v_out := public.rconfig_api(t_write, 'update_config', jsonb_build_object(
             'config_id', v_cfg,
             'payload', jsonb_build_object('title', 'Real copy', 'body', 'Written by the operator.')));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL CF-8: %', v_out ->> 'error';
  END IF;
  SELECT payload ->> 'title' INTO v_txt FROM public.config WHERE id = v_cfg;
  IF v_txt <> 'Real copy' THEN
    RAISE EXCEPTION 'FAIL CF-8: payload not updated (title=%)', v_txt;
  END IF;

  -- ── CF-9 an absent key leaves its field ALONE ────────────────────────────────────────────
  -- Otherwise updating copy silently clears targeting the caller never mentioned.
  UPDATE public.config SET screens = ARRAY['home'], priority = 7 WHERE id = v_cfg;
  v_out := public.rconfig_api(t_write, 'update_config', jsonb_build_object(
             'config_id', v_cfg,
             'payload', jsonb_build_object('title', 'Newer copy', 'body', 'Still targeted.')));
  SELECT screens, priority INTO v_arr, v_count FROM public.config WHERE id = v_cfg;
  IF v_arr <> ARRAY['home'] OR v_count <> 7 THEN
    RAISE EXCEPTION 'FAIL CF-9: an unmentioned field was overwritten (screens=%, priority=%)', v_arr, v_count;
  END IF;

  -- ── CF-10 an explicit [] CAN clear a field back to "everywhere" ──────────────────────────
  v_out := public.rconfig_api(t_write, 'update_config',
             jsonb_build_object('config_id', v_cfg, 'screens', '[]'::jsonb));
  SELECT screens INTO v_arr FROM public.config WHERE id = v_cfg;
  IF v_arr <> '{}'::text[] THEN
    RAISE EXCEPTION 'FAIL CF-10: an explicit empty array did not clear the field (screens=%)', v_arr;
  END IF;

  -- ── CF-11 enabling is an update, and it takes ────────────────────────────────────────────
  v_out := public.rconfig_api(t_write, 'update_config',
             jsonb_build_object('config_id', v_cfg, 'is_enabled', true));
  SELECT is_enabled INTO v_bool FROM public.config WHERE id = v_cfg;
  IF NOT v_bool THEN
    RAISE EXCEPTION 'FAIL CF-11: the config did not go live';
  END IF;

  -- ── CF-12 the default is COPIED, not referenced ──────────────────────────────────────────
  -- Editing a template must never rewrite live content under every app that instantiated it.
  UPDATE public.template SET default_payload = jsonb_build_object(
    'title','Template changed underneath','body','If this reaches a config, defaults are a live reference.')
   WHERE id = 'announcement';
  SELECT payload ->> 'title' INTO v_txt FROM public.config WHERE id = v_cfg;
  IF v_txt = 'Template changed underneath' THEN
    RAISE EXCEPTION 'FAIL CF-12: editing a template rewrote an existing config';
  END IF;

  -- ── CF-13 list_configs returns the app's configs ─────────────────────────────────────────
  v_out := public.rconfig_api(t_read, 'list_configs', jsonb_build_object('app_id', app_beta));
  IF jsonb_array_length(v_out -> 'data') < 1 THEN
    RAISE EXCEPTION 'FAIL CF-13: list_configs returned nothing';
  END IF;

  -- ── CF-14 a read-only token cannot author ────────────────────────────────────────────────
  v_out := public.rconfig_api(t_read, 'create_config',
             jsonb_build_object('app_id', app_beta, 'template_id', 'information'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL CF-14: a read-only token created a config';
  END IF;

  -- ── CF-15 update_config is scope-checked through the CONFIG's app ────────────────────────
  -- It names a config, not an app, so step 2's check does not cover it — the same gap
  -- explain_parameter has. The refusal must not distinguish "not yours" from "does not exist".
  v_out := public.rconfig_api(t_scoped, 'update_config', jsonb_build_object(
             'config_id', v_cfg, 'payload', jsonb_build_object('title','x','body','y')));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL CF-15: a scoped token edited a config outside its scope';
  END IF;
  IF v_out ->> 'error' <> 'no such config' THEN
    RAISE EXCEPTION 'FAIL CF-15: the refusal leaks that the config exists: %', v_out ->> 'error';
  END IF;

  RAISE NOTICE 'config authoring: 15/15 assertions passed';
END $$;


-- ════════════════════════════════════════════════════════════════════════════════════════════
-- One key per app (migration 021).
--
-- A Kotlin Multiplatform app is ONE application on five targets; it had eight keys. Delivery
-- never required that — identity.ts has always read `platform IS NULL` as "any" — so this is
-- about the minting path no longer insisting on a key per target.
-- ════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t_write text; v_out jsonb; v_count int; v_plat text; v_nulls int;
  owner_id uuid := '00000000-0000-0000-0000-0000000000d1';
  app_multi uuid;
BEGIN
  SELECT token INTO t_write FROM public.access_token_create(owner_id,'ok write',30,NULL,ARRAY['read','write']);

  -- ── OK-1 onboarding a five-target app mints TWO keys, not ten ────────────────────────────
  v_out := public.rconfig_api(t_write, 'onboard_app', jsonb_build_object(
             'display_name', 'Five Target App',
             'bundle_id', 'com.example.fivetarget',
             'platforms', jsonb_build_array('android','ios','desktop','web','wasm'),
             'cert_digests', jsonb_build_array('AA:BB')));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL OK-1: %', v_out ->> 'error';
  END IF;
  app_multi := (v_out -> 'data' ->> 'app_id')::uuid;
  IF jsonb_array_length(v_out -> 'data' -> 'keys') <> 2 THEN
    RAISE EXCEPTION 'FAIL OK-1: expected 2 keys for 5 platforms, got %',
      jsonb_array_length(v_out -> 'data' -> 'keys');
  END IF;

  -- ── OK-2 both are platform-agnostic, and one of each environment ─────────────────────────
  SELECT count(*), count(*) FILTER (WHERE platform IS NULL)
    INTO v_count, v_nulls FROM public.app_key WHERE app_id = app_multi;
  IF v_count <> 2 OR v_nulls <> 2 THEN
    RAISE EXCEPTION 'FAIL OK-2: % keys, % platform-agnostic — expected 2 and 2', v_count, v_nulls;
  END IF;
  SELECT count(DISTINCT environment) INTO v_count FROM public.app_key WHERE app_id = app_multi;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL OK-2: expected one live and one test key, found % environments', v_count;
  END IF;

  -- ── OK-3 the live/test split survives, and so does its reason ────────────────────────────
  -- A test key sets attestation off because Play Integrity rejects sideloaded builds. If this
  -- ever collapses to a single key, that is either no attestation in production or no debug
  -- builds at all.
  SELECT count(*) INTO v_count FROM public.app_key
   WHERE app_id = app_multi
     AND ((environment = 'test' AND attestation_policy = 'off')
       OR (environment = 'live' AND attestation_policy = 'preferred'));
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL OK-3: attestation policy wrong on the app keys';
  END IF;

  -- ── OK-4 android digests ride on the shared key ──────────────────────────────────────────
  -- identity.ts applies them only to callers asserting android; dropping them here would
  -- silently remove the binding for the one platform that has one.
  SELECT count(*) INTO v_count FROM public.app_key
   WHERE app_id = app_multi AND cert_digests @> ARRAY['AA:BB'];
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL OK-4: digests missing from the shared keys (% of 2)', v_count;
  END IF;

  -- ── OK-5 issue_key with no platform mints an all-platform key ────────────────────────────
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', app_multi, 'environment', 'live', 'rotate', true));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL OK-5: %', v_out ->> 'error';
  END IF;
  SELECT platform INTO v_plat FROM public.app_key
   WHERE app_id = app_multi ORDER BY created_at DESC LIMIT 1;
  IF v_plat IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL OK-5: omitting platform produced a key pinned to %', v_plat;
  END IF;

  -- ── OK-6 a repeat all-platform issue is still refused ────────────────────────────────────
  -- `k.platform = v_plat` is never true when both are NULL, so the duplicate guard had to move
  -- to IS NOT DISTINCT FROM. Without that, the one-key-per-app path silently loses the very
  -- protection that makes it safe to re-run.
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', app_multi, 'environment', 'live'));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL OK-6: a duplicate all-platform key was minted silently';
  END IF;

  -- ── OK-7 pinning still works for the genuine exception ───────────────────────────────────
  v_out := public.rconfig_api(t_write, 'issue_key', jsonb_build_object(
             'app_id', app_multi, 'platform', 'ios', 'environment', 'test'));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL OK-7: pinning was refused: %', v_out ->> 'error';
  END IF;
  SELECT count(*) INTO v_count FROM public.app_key
   WHERE app_id = app_multi AND platform = 'ios';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL OK-7: expected one pinned ios key, found %', v_count;
  END IF;

  -- ── OK-8 a bad platform is still named, and says it may be omitted ───────────────────────
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', app_multi, 'platform', 'blackberry'));
  IF v_out ->> 'error' NOT LIKE '%omitted%' THEN
    RAISE EXCEPTION 'FAIL OK-8: the refusal does not mention that platform is optional: %',
      v_out ->> 'error';
  END IF;

  RAISE NOTICE 'one key per app: 8/8 assertions passed';
END $$;


-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Key lifecycle — list_keys / revoke_key (migration 022).
--
-- Keys could be minted and never retired through the API: revoking existed only as a dashboard
-- button, so anything that replaced an app's keys could not clean up after itself. The two ops
-- land together because without list_keys there is no way to learn an id to revoke.
-- ════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t_write text; t_read text; v_out jsonb; v_count int;
  owner_id uuid := '00000000-0000-0000-0000-0000000000d1';
  v_app uuid; k_live uuid; k_test uuid; k_extra uuid;
BEGIN
  SELECT token INTO t_write FROM public.access_token_create(owner_id,'kl write',30,NULL,ARRAY['read','write']);
  SELECT token INTO t_read  FROM public.access_token_create(owner_id,'kl read', 30,NULL,ARRAY['read']);

  v_out := public.rconfig_api(t_write, 'onboard_app', jsonb_build_object(
             'display_name','Key Lifecycle App','bundle_id','com.example.kl',
             'platforms', jsonb_build_array('android','ios')));
  v_app := (v_out -> 'data' ->> 'app_id')::uuid;
  SELECT id INTO k_live FROM public.app_key WHERE app_id = v_app AND environment = 'live';
  SELECT id INTO k_test FROM public.app_key WHERE app_id = v_app AND environment = 'test';

  -- ── KL-1 list_keys returns the app's keys, key string included ───────────────────────────
  -- Public by construction: a publishable key ships inside every client binary.
  v_out := public.rconfig_api(t_read, 'list_keys', jsonb_build_object('app_id', v_app));
  IF jsonb_array_length(v_out -> 'data') <> 2 THEN
    RAISE EXCEPTION 'FAIL KL-1: expected 2 keys, got %', jsonb_array_length(v_out -> 'data');
  END IF;
  IF (v_out -> 'data' -> 0 ->> 'key') NOT LIKE 'rck_%' THEN
    RAISE EXCEPTION 'FAIL KL-1: the key string is missing from list_keys';
  END IF;

  -- ── KL-2 the LAST active key of an environment is not revocable by accident ──────────────
  -- Revoking it 403s every client in that environment on the next fetch — felt by end users,
  -- not by the operator who typed the command.
  v_out := public.rconfig_api(t_write, 'revoke_key', jsonb_build_object('key_id', k_live));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL KL-2: the only live key was revoked without force';
  END IF;
  IF v_out ->> 'error' NOT LIKE '%force%' THEN
    RAISE EXCEPTION 'FAIL KL-2: the refusal does not say how to proceed: %', v_out ->> 'error';
  END IF;
  SELECT count(*) INTO v_count FROM public.app_key WHERE id = k_live AND revoked_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL KL-2: the key was revoked despite the refusal';
  END IF;

  -- ── KL-3 with a replacement in place, revoking the old one is allowed ────────────────────
  v_out := public.rconfig_api(t_write, 'issue_key',
             jsonb_build_object('app_id', v_app, 'environment', 'live', 'rotate', true));
  SELECT id INTO k_extra FROM public.app_key
   WHERE app_id = v_app AND environment = 'live' AND id <> k_live;
  v_out := public.rconfig_api(t_write, 'revoke_key', jsonb_build_object('key_id', k_live));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL KL-3: %', v_out ->> 'error';
  END IF;
  SELECT count(*) INTO v_count FROM public.app_key WHERE id = k_live AND revoked_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL KL-3: revoke reported success but the row is still active';
  END IF;

  -- ── KL-4 revoking again is idempotent, not an error ──────────────────────────────────────
  -- A cleanup that re-runs must not trip on rows it already handled.
  v_out := public.rconfig_api(t_write, 'revoke_key', jsonb_build_object('key_id', k_live));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL KL-4: re-revoking errored: %', v_out ->> 'error';
  END IF;
  IF (v_out -> 'data' ->> 'already_revoked') <> 'true' THEN
    RAISE EXCEPTION 'FAIL KL-4: re-revoking did not report already_revoked';
  END IF;

  -- ── KL-5 force overrides the last-key guard ──────────────────────────────────────────────
  v_out := public.rconfig_api(t_write, 'revoke_key',
             jsonb_build_object('key_id', k_test, 'force', true));
  IF v_out -> 'error' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL KL-5: force was refused: %', v_out ->> 'error';
  END IF;

  -- ── KL-6 a read-only token cannot revoke ─────────────────────────────────────────────────
  v_out := public.rconfig_api(t_read, 'revoke_key', jsonb_build_object('key_id', k_extra));
  IF v_out -> 'error' IS NULL THEN
    RAISE EXCEPTION 'FAIL KL-6: a read-only token revoked a key';
  END IF;

  -- ── KL-7 a key outside the token's scope is indistinguishable from a missing one ─────────
  DECLARE t_scoped text;
  BEGIN
    SELECT token INTO t_scoped FROM public.access_token_create(owner_id,'kl alpha',30,
      ARRAY['00000000-0000-0000-0000-0000000000e1']::uuid[], ARRAY['read','write']);
    v_out := public.rconfig_api(t_scoped, 'revoke_key', jsonb_build_object('key_id', k_extra));
    IF v_out ->> 'error' <> 'no such key' THEN
      RAISE EXCEPTION 'FAIL KL-7: the refusal leaks that the key exists: %', v_out ->> 'error';
    END IF;
  END;

  RAISE NOTICE 'key lifecycle: 7/7 assertions passed';
END $$;


ROLLBACK;
