-- ============================================================
-- issue_key — add a platform key to an app that already exists.
--
-- WHY THIS MIGRATION RESTATES THE WHOLE FUNCTION
-- Postgres has no way to add one branch to an existing function body, so a new operation on
-- `rconfig_api` means CREATE OR REPLACE with the full definition. 017 remains the readable
-- origin of the funnel's design; THIS file is the definition in force. The body below is
-- 017's, byte for byte, plus: two loop locals, one row in the permission CASE, and one
-- dispatch branch.
--
-- WHAT IT FIXES
-- `onboard_app` mints keys only while CREATING an app, and refuses a slug that already exists.
-- So an operator who registered an app for Android and later shipped an iOS build had no API
-- path to an iOS key at all — and could not reuse the Android one, because `app_key.platform`
-- is enforced (`_shared/identity.ts` → 403 `platform_mismatch`). The only remaining route was a
-- direct write to `app_key`, which is exactly the unscoped database access migration 017 exists
-- to eliminate.
--
-- Found while wiring the iOS sample host: the app ran, and `Fetch` answered `key_invalid`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rconfig_api(p_token text, p_op text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_tok    record;
  v_app    uuid;
  v_need   text;
  v_data   jsonb;
  v_int    int;
  v_id     uuid;
  v_key    text;
  v_rows   jsonb;
  v_plat   text;
  v_env    text;
  v_envs   text[];
  v_one    text;
BEGIN
  -- ── 1. AUTHENTICATE ───────────────────────────────────────────────────────────
  -- One error shape for unknown, malformed, revoked and expired alike. Distinguishing them
  -- would make this function an oracle for probing which tokens are real.
  SELECT * INTO v_tok FROM public.access_token_verify(p_token);
  IF v_tok.user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'the access token is not valid');
  END IF;

  -- ── 2. AUTHORIZE ──────────────────────────────────────────────────────────────
  -- The permission each operation needs. Deliberately a lookup rather than a check inside each
  -- branch: an operation missing from this CASE falls to ELSE and is REFUSED, so forgetting to
  -- classify a new operation fails closed.
  v_need := CASE p_op
    WHEN 'list_apps'          THEN 'read'
    WHEN 'list_parameters'    THEN 'read'
    WHEN 'list_conditions'    THEN 'read'
    WHEN 'list_versions'      THEN 'read'
    WHEN 'preview_for_device' THEN 'read'
    WHEN 'explain_parameter'  THEN 'read'
    WHEN 'onboard_app'        THEN 'write'
    WHEN 'issue_key'          THEN 'write'
    WHEN 'create_parameter'   THEN 'write'
    WHEN 'create_condition'   THEN 'write'
    WHEN 'add_override'       THEN 'write'
    WHEN 'publish'            THEN 'publish'
    WHEN 'rollback'           THEN 'publish'
    ELSE NULL
  END;

  IF v_need IS NULL THEN
    -- Reached only by an AUTHENTICATED caller: an invalid token was already turned away above,
    -- so this cannot be used to enumerate which operations exist.
    RETURN jsonb_build_object('error', format('unknown operation: %s', p_op));
  END IF;

  IF NOT (v_tok.permissions @> ARRAY[v_need]) THEN
    RETURN jsonb_build_object('error', format(
      'this access token needs the ''%s'' permission. It has: %s',
      v_need, coalesce(array_to_string(v_tok.permissions, ', '), 'none')));
  END IF;

  -- App scope. Checked here, once, for every operation that names an app — rather than inside
  -- each branch, where one omission is a hole.
  v_app := nullif(p_args ->> 'app_id','')::uuid;
  IF v_app IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.access_token_apps(v_tok.token_id, v_tok.user_id, v_tok.app_ids IS NOT NULL)
       WHERE app_id = v_app
    ) THEN
      RETURN jsonb_build_object('error', format(
        'app %s is not in this token''s scope, or its owner is not a member of it', v_app));
    END IF;
  END IF;

  -- ── 3. DISPATCH ───────────────────────────────────────────────────────────────
  IF p_op = 'list_apps' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_data
      FROM (SELECT a.id, a.slug, a.display_name, a.platforms, a.created_at
              FROM public.app a
              JOIN public.access_token_apps(v_tok.token_id, v_tok.user_id, v_tok.app_ids IS NOT NULL) s
                ON s.app_id = a.id) x;
    RETURN jsonb_build_object('data', v_data);

  ELSIF p_op = 'list_parameters' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.key), '[]'::jsonb) INTO v_data
      FROM (SELECT p.id, p.key, p.type, p.default_value, p.description,
                   (SELECT count(*) FROM public.parameter_value pv WHERE pv.parameter_id = p.id) AS override_count
              FROM public.parameter p WHERE p.app_id = v_app) x;
    RETURN jsonb_build_object('data', v_data);

  ELSIF p_op = 'list_conditions' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.priority), '[]'::jsonb) INTO v_data
      FROM (SELECT c.id, c.name, c.predicate, c.priority,
                   (SELECT count(*) FROM public.parameter_value pv WHERE pv.condition_id = c.id) AS used_by
              FROM public.condition c WHERE c.app_id = v_app) x;
    RETURN jsonb_build_object('data', v_data);

  ELSIF p_op = 'list_versions' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.version DESC), '[]'::jsonb) INTO v_data
      FROM (SELECT v.version, v.published_at, v.published_by, v.rolled_back_from
              FROM public.config_version v WHERE v.app_id = v_app) x;
    RETURN jsonb_build_object('data', v_data);

  ELSIF p_op = 'preview_for_device' THEN
    RETURN jsonb_build_object('data', public.resolve_parameters(v_app, p_args -> 'audience'));

  ELSIF p_op = 'explain_parameter' THEN
    -- Takes a parameter id, not an app id, so the scope check above did not cover it. Resolve
    -- the owning app and check it HERE rather than trusting the caller — this is exactly the
    -- per-branch omission the funnel is designed to make unnecessary everywhere else, and the
    -- one place it genuinely cannot.
    v_id := nullif(p_args ->> 'parameter_id','')::uuid;
    SELECT p.app_id INTO v_app FROM public.parameter p WHERE p.id = v_id;
    IF v_app IS NULL THEN
      RETURN jsonb_build_object('error', 'no such parameter');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.access_token_apps(v_tok.token_id, v_tok.user_id, v_tok.app_ids IS NOT NULL)
       WHERE app_id = v_app
    ) THEN
      -- Same message as an unreachable app: a caller must not learn that a parameter id is real
      -- by the shape of the refusal.
      RETURN jsonb_build_object('error', 'no such parameter');
    END IF;
    RETURN jsonb_build_object('data', public.resolve_parameter_explain(v_id, p_args -> 'audience'));

  ELSIF p_op = 'onboard_app' THEN
    IF v_tok.app_ids IS NOT NULL THEN
      RETURN jsonb_build_object('error',
        'this access token is scoped to specific apps, so it cannot register a new one');
    END IF;
    v_key := lower(regexp_replace(trim(p_args ->> 'display_name'), '[^a-zA-Z0-9]+', '-', 'g'));
    v_key := trim(both '-' from v_key);
    IF v_key = '' THEN
      RETURN jsonb_build_object('error', 'display_name has no letters or digits to build a slug from');
    END IF;
    IF jsonb_array_length(coalesce(p_args -> 'platforms','[]'::jsonb)) = 0 THEN
      RETURN jsonb_build_object('error', 'at least one platform is required');
    END IF;
    BEGIN
      INSERT INTO public.app (owner_id, slug, display_name, platforms)
      VALUES (v_tok.user_id, v_key, trim(p_args ->> 'display_name'),
              ARRAY(SELECT jsonb_array_elements_text(p_args -> 'platforms')))
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', format('an app with slug "%s" already exists for this owner', v_key));
    END;
    INSERT INTO public.app_member (app_id, user_id, role) VALUES (v_id, v_tok.user_id, 'owner')
      ON CONFLICT (app_id, user_id) DO NOTHING;
    v_rows := '[]'::jsonb;
    FOR v_plat IN SELECT jsonb_array_elements_text(p_args -> 'platforms') LOOP
      FOREACH v_env IN ARRAY ARRAY['live','test'] LOOP
        v_key := public.generate_publishable_key(v_env);
        INSERT INTO public.app_key (app_id, key, label, environment, platform, bundle_id, cert_digests, attestation_policy)
        VALUES (v_id, v_key, v_plat || ' ' || v_env, v_env, v_plat, trim(p_args ->> 'bundle_id'),
                CASE WHEN v_plat = 'android'
                     THEN ARRAY(SELECT jsonb_array_elements_text(coalesce(p_args -> 'cert_digests','[]'::jsonb)))
                     ELSE ARRAY[]::text[] END,
                CASE WHEN v_env = 'test' THEN 'off' ELSE 'preferred' END);
        v_rows := v_rows || jsonb_build_object('platform', v_plat, 'environment', v_env, 'key', v_key);
      END LOOP;
    END LOOP;
    RETURN jsonb_build_object('data', jsonb_build_object('app_id', v_id, 'keys', v_rows));

  ELSIF p_op = 'create_parameter' THEN
    BEGIN
      INSERT INTO public.parameter (app_id, key, type, default_value, description)
      VALUES (v_app, p_args ->> 'key', p_args ->> 'type', p_args -> 'default_value', p_args ->> 'description')
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', format('this app already has a parameter named "%s"', p_args ->> 'key'));
    END;
    RETURN jsonb_build_object('data', jsonb_build_object('id', v_id));

  ELSIF p_op = 'create_condition' THEN
    BEGIN
      INSERT INTO public.condition (app_id, name, predicate, priority)
      VALUES (v_app, p_args ->> 'name', p_args -> 'predicate', (p_args ->> 'priority')::int)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', format('this app already has a condition named "%s"', p_args ->> 'name'));
    END;
    RETURN jsonb_build_object('data', jsonb_build_object('id', v_id));

  ELSIF p_op = 'add_override' THEN
    -- Like explain_parameter, this names a PARAMETER rather than an app, so the scope check
    -- above did not cover it. Resolve the owning app and check it here.
    --
    -- Found by the type checker, not by review: the MCP tool's schema has no app_id field at
    -- all, so the funnel's scope check was silently skipped for the one write that can change
    -- what a targeted audience receives. A scoped token could have overridden a parameter in an
    -- app outside its scope.
    v_id := nullif(p_args ->> 'parameter_id','')::uuid;
    SELECT p.app_id INTO v_app FROM public.parameter p WHERE p.id = v_id;
    IF v_app IS NULL THEN
      RETURN jsonb_build_object('error', 'no such parameter');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.access_token_apps(v_tok.token_id, v_tok.user_id, v_tok.app_ids IS NOT NULL)
       WHERE app_id = v_app
    ) THEN
      RETURN jsonb_build_object('error', 'no such parameter');
    END IF;
    -- The condition must belong to the SAME app. Without this, a caller inside one app could
    -- attach another app's condition to its parameter and silently couple the two.
    IF NOT EXISTS (
      SELECT 1 FROM public.condition c
       WHERE c.id = nullif(p_args ->> 'condition_id','')::uuid AND c.app_id = v_app
    ) THEN
      RETURN jsonb_build_object('error', 'that condition does not belong to this parameter''s app');
    END IF;
    BEGIN
      -- priority is NOT NULL with no default. Omitting it made every in-scope add_override
      -- fail — caught by the API-12 CONTROL, which exists precisely because a refusal test and
      -- a broken write are indistinguishable without one. The MCP tool already collects it.
      INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority)
      VALUES ((p_args ->> 'parameter_id')::uuid, (p_args ->> 'condition_id')::uuid, p_args -> 'value',
              coalesce((p_args ->> 'priority')::int,
                       (SELECT c.priority FROM public.condition c
                         WHERE c.id = (p_args ->> 'condition_id')::uuid)));
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error',
        'that condition already overrides this parameter. Remove the existing override first.');
    END;
    RETURN jsonb_build_object('data', jsonb_build_object('ok', true));

  ELSIF p_op = 'issue_key' THEN
    -- Give an app that ALREADY EXISTS a key for a platform it does not have yet.
    --
    -- Before this op there was no way to do that. `onboard_app` is the only other op that mints
    -- keys and it refuses a slug it has seen before ('an app with slug "..." already exists for
    -- this owner'), so shipping an iOS build of an app registered as Android-only meant a direct
    -- database write. Reusing the Android key was never an alternative: `app_key.platform` is a
    -- constraint rather than a hint, and `_shared/identity.ts` answers a mismatch with 403
    -- `platform_mismatch`.
    --
    -- No app-scope check here. `app_id` was checked against the token's scope at step 2, which
    -- is the entire reason the funnel exists — this branch cannot forget to do it.
    IF v_app IS NULL THEN
      RETURN jsonb_build_object('error', 'issue_key needs an app_id');
    END IF;

    v_plat := nullif(p_args ->> 'platform','');
    IF v_plat IS NULL OR v_plat NOT IN ('android','ios','desktop','web','wasm') THEN
      -- Named rather than left to the table's CHECK: a bare constraint violation surfaces to
      -- the operator as a 500 from the edge function with nothing actionable in it.
      RETURN jsonb_build_object('error',
        'platform must be one of android, ios, desktop, web, wasm');
    END IF;

    v_env := nullif(p_args ->> 'environment','');
    IF v_env IS NOT NULL AND v_env NOT IN ('live','test') THEN
      RETURN jsonb_build_object('error', 'environment must be live or test');
    END IF;

    -- Minting a second key for a platform that already has a working one is far more often the
    -- same call made twice than a rotation meant on purpose, so it is refused by default. The
    -- existing key is quoted back: publishable keys are public, so there is nothing to leak, and
    -- an operator who did mean to rotate needs to see which key they are adding alongside.
    IF NOT coalesce((p_args ->> 'rotate')::boolean, false) THEN
      SELECT k.key, k.environment INTO v_key, v_one
        FROM public.app_key k
       WHERE k.app_id = v_app AND k.platform = v_plat
         AND (v_env IS NULL OR k.environment = v_env)
         AND k.revoked_at IS NULL
       ORDER BY k.created_at
       LIMIT 1;
      IF v_key IS NOT NULL THEN
        RETURN jsonb_build_object('error', format(
          'this app already has an active %s %s key (%s). Name an "environment" to issue only '
          || 'the one it is missing, or pass "rotate": true to issue another alongside it.',
          v_plat, v_one, v_key));
      END IF;
    END IF;

    -- Both environments by default, which is what `onboard_app` does per platform. A caller
    -- that names one gets only that one.
    v_envs := CASE WHEN v_env IS NULL THEN ARRAY['live','test'] ELSE ARRAY[v_env] END;
    v_rows := '[]'::jsonb;
    FOREACH v_one IN ARRAY v_envs LOOP
      v_key := public.generate_publishable_key(v_one);
      INSERT INTO public.app_key
        (app_id, key, label, environment, platform, bundle_id, cert_digests, attestation_policy)
      VALUES (
        v_app, v_key, v_plat || ' ' || v_one, v_one, v_plat,
        -- The bundle id belongs to the APP — `onboard_app` writes one value to every key it
        -- mints — so inheriting it keeps the common call to two arguments. An explicit value
        -- still wins, for a platform that genuinely ships under a different identifier.
        coalesce(
          nullif(p_args ->> 'bundle_id',''),
          (SELECT k.bundle_id FROM public.app_key k
            WHERE k.app_id = v_app AND k.bundle_id IS NOT NULL
            ORDER BY k.created_at LIMIT 1)),
        CASE WHEN v_plat = 'android'
             THEN ARRAY(SELECT jsonb_array_elements_text(coalesce(p_args -> 'cert_digests','[]'::jsonb)))
             ELSE ARRAY[]::text[] END,
        -- Same posture as onboarding: a test key skips attestation so a debug build works, a
        -- live key prefers it. 'required' is never set here — that is a deliberate decision an
        -- operator makes later, not a default that silently locks out their own first build.
        CASE WHEN v_one = 'test' THEN 'off' ELSE 'preferred' END);
      v_rows := v_rows || jsonb_build_object('platform', v_plat, 'environment', v_one, 'key', v_key);
    END LOOP;

    -- Keep `app.platforms` honest. `list_apps` and the dashboard read it, so an app serving an
    -- iOS key while still describing itself as Android-only is a row that contradicts itself.
    UPDATE public.app
       SET platforms = array_append(platforms, v_plat), updated_at = now()
     WHERE id = v_app AND NOT (platforms @> ARRAY[v_plat]);

    RETURN jsonb_build_object('data', jsonb_build_object('app_id', v_app, 'keys', v_rows));

  ELSIF p_op = 'publish' THEN
    v_int := public.publish(v_app);
    RETURN jsonb_build_object('data', jsonb_build_object('version', v_int));

  ELSIF p_op = 'rollback' THEN
    v_int := public.rollback_to(v_app, (p_args ->> 'version')::int);
    RETURN jsonb_build_object('data', jsonb_build_object('version', v_int));
  END IF;

  -- Unreachable: an unclassified operation was refused at the authorize step. Present so a
  -- future operation added to the CASE but not to the dispatch cannot fall through silently.
  RETURN jsonb_build_object('error', format('operation %s is classified but not implemented', p_op));
END $$;

-- Unchanged from 017 and repeated because CREATE OR REPLACE resets neither: no client role may
-- execute the funnel. The service role bypasses grants, so `v1-admin` still reaches it.
REVOKE EXECUTE ON FUNCTION public.rconfig_api(text, text, jsonb) FROM PUBLIC, anon, authenticated;
