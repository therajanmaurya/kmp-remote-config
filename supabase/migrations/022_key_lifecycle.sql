-- ============================================================
-- list_keys + revoke_key — closing the key lifecycle on the API.
--
-- `onboard_app` and `issue_key` could MINT keys and nothing could retire them. Revoking existed
-- only as a button in the dashboard, which meant an agent or script that had just replaced an
-- app's keys had no way to clean up after itself — and the Keys page accumulated every key the
-- app had ever had.
--
-- They arrive together on purpose: without `list_keys` there is no way to learn a `key_id`, so
-- `revoke_key` alone would be an operation no caller could actually invoke.
--
-- Returning the key STRING from list_keys is not a disclosure. A publishable key ships inside
-- every client binary; what protects it is the package + certificate binding and attestation.
-- The secret in this system is the `rcp_` access token, which this funnel authenticates and
-- never returns.
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
  v_ack    boolean;
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
    WHEN 'list_keys'          THEN 'read'
    WHEN 'revoke_key'         THEN 'write'
    WHEN 'list_configs'       THEN 'read'
    WHEN 'create_config'      THEN 'write'
    WHEN 'update_config'      THEN 'write'
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
    -- TWO keys for the whole app — one live, one test — not two per platform.
    --
    -- A Kotlin Multiplatform app is ONE application that happens to run on five targets. Minting
    -- a key per target made an eight-row Keys page for a single app, forced every host to carry
    -- a different literal, and made "which key is this build" a question an integrator had to
    -- answer per target. `app_key.platform` already treats NULL as "any" in
    -- `_shared/identity.ts`, so the platform-agnostic key needed no new column — only for the
    -- minting path to stop insisting on one.
    --
    -- The live/test split STAYS, because it is not cosmetic: a test key carries
    -- `attestation_policy = off`, and Play Integrity rejects sideloaded and debug builds. One
    -- key for both would mean either no attestation in production or no debug builds at all.
    v_rows := '[]'::jsonb;
    FOREACH v_env IN ARRAY ARRAY['live','test'] LOOP
      v_key := public.generate_publishable_key(v_env);
      INSERT INTO public.app_key (app_id, key, label, environment, platform, bundle_id, cert_digests, attestation_policy)
      VALUES (v_id, v_key, v_env, v_env, NULL, trim(p_args ->> 'bundle_id'),
              -- Digests ride on the shared key. They are enforced only for callers asserting
              -- android (see identity.ts); on a shared key an unconditional check would reject
              -- every iOS, desktop and web caller, which is the one way this change could break
              -- a working app.
              ARRAY(SELECT jsonb_array_elements_text(coalesce(p_args -> 'cert_digests','[]'::jsonb))),
              CASE WHEN v_env = 'test' THEN 'off' ELSE 'preferred' END);
      v_rows := v_rows || jsonb_build_object('platform', NULL, 'environment', v_env, 'key', v_key);
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

    -- Platform is now OPTIONAL and absent means EVERY platform, which is the normal case for a
    -- Kotlin Multiplatform app. Pinning remains available for the genuine exception — a
    -- white-label build shipped from a different bundle id, say — but it is no longer the shape
    -- the common path is forced through.
    v_plat := nullif(p_args ->> 'platform','');
    IF v_plat IS NOT NULL AND v_plat NOT IN ('android','ios','desktop','web','wasm') THEN
      -- Named rather than left to the table's CHECK: a bare constraint violation surfaces to
      -- the operator as a 500 from the edge function with nothing actionable in it.
      RETURN jsonb_build_object('error',
        'platform must be one of android, ios, desktop, web, wasm — or omitted for all of them');
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
       WHERE k.app_id = v_app AND k.platform IS NOT DISTINCT FROM v_plat
         AND (v_env IS NULL OR k.environment = v_env)
         AND k.revoked_at IS NULL
       ORDER BY k.created_at
       LIMIT 1;
      IF v_key IS NOT NULL THEN
        RETURN jsonb_build_object('error', format(
          'this app already has an active %s %s key (%s). Name an "environment" to issue only '
          || 'the one it is missing, or pass "rotate": true to issue another alongside it.',
          coalesce(v_plat, 'all-platform'), v_one, v_key));
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
        v_app, v_key, coalesce(v_plat || ' ', '') || v_one, v_one, v_plat,
        -- The bundle id belongs to the APP — `onboard_app` writes one value to every key it
        -- mints — so inheriting it keeps the common call to two arguments. An explicit value
        -- still wins, for a platform that genuinely ships under a different identifier.
        coalesce(
          nullif(p_args ->> 'bundle_id',''),
          (SELECT k.bundle_id FROM public.app_key k
            WHERE k.app_id = v_app AND k.bundle_id IS NOT NULL
            ORDER BY k.created_at LIMIT 1)),
        -- An all-platform key carries digests too; identity.ts applies them only to callers
        -- asserting android.
        CASE WHEN v_plat IS NULL OR v_plat = 'android'
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
    -- Only a PINNED key says anything new about which platforms the app ships on; an
    -- all-platform key makes no such claim and must not invent one.
    IF v_plat IS NOT NULL THEN
      UPDATE public.app
         SET platforms = array_append(platforms, v_plat), updated_at = now()
       WHERE id = v_app AND NOT (platforms @> ARRAY[v_plat]);
    END IF;

    RETURN jsonb_build_object('data', jsonb_build_object('app_id', v_app, 'keys', v_rows));

  ELSIF p_op = 'list_configs' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.template_id), '[]'::jsonb) INTO v_data
      FROM (SELECT c.id, c.template_id, c.display, c.is_enabled, c.priority,
                   c.screens, c.platforms, c.payload
              FROM public.config c WHERE c.app_id = v_app) x;
    RETURN jsonb_build_object('data', v_data);

  ELSIF p_op = 'create_config' THEN
    IF v_app IS NULL THEN
      RETURN jsonb_build_object('error', 'create_config needs an app_id');
    END IF;
    v_key := nullif(p_args ->> 'template_id','');
    IF v_key IS NULL THEN
      RETURN jsonb_build_object('error', 'create_config needs a template_id');
    END IF;

    -- A custom template belongs to ONE app; a builtin is global. Reading both through the same
    -- predicate is what stops an app instantiating another tenant's private template.
    SELECT t.default_payload, t.allowed_displays[1], t.requires_ack
      INTO v_data, v_one, v_ack
      FROM public.template t
     WHERE t.id = v_key AND (t.is_builtin OR t.app_id = v_app);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error',
        format('no template named "%s" is available to this app', v_key));
    END IF;

    -- The caller's payload, else the template's default. COPIED, never referenced: editing a
    -- template later must not rewrite live content under every app that instantiated it.
    v_data := coalesce(p_args -> 'payload', v_data);
    IF v_data IS NULL THEN
      RETURN jsonb_build_object('error',
        format('template "%s" carries no default payload, so one must be supplied', v_key));
    END IF;
    v_one := coalesce(nullif(p_args ->> 'display',''), v_one);

    BEGIN
      -- `is_enabled` is deliberately absent: the column defaults FALSE and this op does not
      -- offer to override it. A config created live is a message shown to real users by a
      -- call that was only meant to author one.
      -- `is_dismissible` is DERIVED, not defaulted. The column defaults TRUE while the
      -- coherence trigger refuses a dismissible config on a requires_ack template, so a
      -- create that simply omits it cannot author `policy_update` at all — one of the
      -- fifteen builtins, unreachable through its own API. The operator can still override.
      INSERT INTO public.config (app_id, template_id, payload, display, is_dismissible,
                                 screens, platforms, priority)
      VALUES (v_app, v_key, v_data, v_one,
              coalesce((p_args ->> 'is_dismissible')::boolean, NOT v_ack),
              ARRAY(SELECT jsonb_array_elements_text(coalesce(p_args -> 'screens','[]'::jsonb))),
              ARRAY(SELECT jsonb_array_elements_text(coalesce(p_args -> 'platforms','[]'::jsonb))),
              coalesce((p_args ->> 'priority')::int, 0))
      RETURNING id INTO v_id;
    EXCEPTION
      -- The coherence trigger raises for a disallowed display or a payload that fails its
      -- schema. Passing its message through is the point: "display banner not allowed for
      -- template paywall_upsell" tells the operator exactly what to change, where a generic
      -- failure sends them to the logs.
      WHEN raise_exception OR check_violation THEN
        RETURN jsonb_build_object('error', SQLERRM);
    END;
    RETURN jsonb_build_object('data', jsonb_build_object('id', v_id, 'is_enabled', false));

  ELSIF p_op = 'update_config' THEN
    v_id := nullif(p_args ->> 'config_id','')::uuid;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'update_config needs a config_id');
    END IF;

    -- Names a CONFIG, not an app, so step 2's scope check did not cover it — the same gap
    -- explain_parameter has, handled the same way. The refusal is identical for "does not
    -- exist" and "not yours", so a caller cannot probe for real config ids.
    SELECT c.app_id INTO v_app FROM public.config c WHERE c.id = v_id;
    IF v_app IS NULL THEN
      RETURN jsonb_build_object('error', 'no such config');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.access_token_apps(v_tok.token_id, v_tok.user_id, v_tok.app_ids IS NOT NULL)
       WHERE app_id = v_app
    ) THEN
      RETURN jsonb_build_object('error', 'no such config');
    END IF;

    BEGIN
      -- Absent key = leave alone, so a caller updating copy cannot blank targeting it never
      -- mentioned. `p_args ? 'screens'` rather than a null test, so an explicit [] can still
      -- clear a field back to "every screen".
      UPDATE public.config SET
        payload    = coalesce(p_args -> 'payload', payload),
        display    = coalesce(nullif(p_args ->> 'display',''), display),
        is_enabled = coalesce((p_args ->> 'is_enabled')::boolean, is_enabled),
        priority   = coalesce((p_args ->> 'priority')::int, priority),
        screens    = CASE WHEN p_args ? 'screens'
                          THEN ARRAY(SELECT jsonb_array_elements_text(p_args -> 'screens'))
                          ELSE screens END,
        platforms  = CASE WHEN p_args ? 'platforms'
                          THEN ARRAY(SELECT jsonb_array_elements_text(p_args -> 'platforms'))
                          ELSE platforms END
      WHERE id = v_id;
    EXCEPTION
      WHEN raise_exception OR check_violation THEN
        RETURN jsonb_build_object('error', SQLERRM);
    END;
    RETURN jsonb_build_object('data', jsonb_build_object('id', v_id));

  ELSIF p_op = 'list_keys' THEN
    -- Publishable keys are public by construction — they ship inside every client binary — so
    -- returning the key itself is not a disclosure. Without this op `revoke_key` would be
    -- unusable from the API: there would be no way to learn an id to revoke.
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at), '[]'::jsonb) INTO v_data
      FROM (SELECT k.id, k.key, k.label, k.environment, k.platform, k.bundle_id,
                   k.cert_digests, k.attestation_policy, k.revoked_at, k.created_at
              FROM public.app_key k WHERE k.app_id = v_app) x;
    RETURN jsonb_build_object('data', v_data);

  ELSIF p_op = 'revoke_key' THEN
    v_id := nullif(p_args ->> 'key_id','')::uuid;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'revoke_key needs a key_id');
    END IF;

    -- Names a KEY, not an app, so step 2's scope check did not cover it — same shape as
    -- update_config. The refusal is identical for "no such key" and "not yours" so a caller
    -- cannot probe for real key ids.
    SELECT k.app_id, k.environment, k.revoked_at IS NOT NULL
      INTO v_app, v_one, v_ack
      FROM public.app_key k WHERE k.id = v_id;
    IF v_app IS NULL THEN
      RETURN jsonb_build_object('error', 'no such key');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.access_token_apps(v_tok.token_id, v_tok.user_id, v_tok.app_ids IS NOT NULL)
       WHERE app_id = v_app
    ) THEN
      RETURN jsonb_build_object('error', 'no such key');
    END IF;

    -- Idempotent rather than an error: a cleanup script that re-runs should not fail on the
    -- rows it already dealt with, and "already revoked" is the state the caller asked for.
    IF v_ack THEN
      RETURN jsonb_build_object('data', jsonb_build_object('id', v_id, 'already_revoked', true));
    END IF;

    -- Revoking the LAST active key of an environment takes every client in that environment
    -- offline at once — a 403 on the next fetch for everyone, with no replacement to move to.
    -- That is almost never what someone cleaning up old keys means, and unlike most mistakes
    -- here it is felt by end users rather than by the operator. `force` is the way to say it
    -- was meant; issuing the replacement first is the way to avoid needing it.
    SELECT count(*) INTO v_int FROM public.app_key k
     WHERE k.app_id = v_app AND k.environment = v_one
       AND k.revoked_at IS NULL AND k.id <> v_id;
    IF v_int = 0 AND NOT coalesce((p_args ->> 'force')::boolean, false) THEN
      RETURN jsonb_build_object('error', format(
        'this is the only active %s key for the app — revoking it would 403 every %s client on '
        || 'its next fetch. Issue the replacement first, or pass "force": true if that is '
        || 'genuinely what you want.', v_one, v_one));
    END IF;

    UPDATE public.app_key SET revoked_at = now() WHERE id = v_id;
    RETURN jsonb_build_object('data', jsonb_build_object('id', v_id, 'revoked', true));

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

REVOKE EXECUTE ON FUNCTION public.rconfig_api(text, text, jsonb) FROM PUBLIC, anon, authenticated;
