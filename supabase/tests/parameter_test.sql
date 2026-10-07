-- Phase 03 / T1+T2 — typed parameters and named, REUSABLE conditions.
--
-- The half of Firebase Remote Config this product has never had. Values currently exist only
-- as a `feature_flag` config row with a free-form payload: no type, no default, no way to say
-- "this value, but different for Android beta users" without authoring a second row.
--
-- The ergonomic win being copied is REUSE: a condition named once attaches to many parameters,
-- and editing it changes all of them. That only holds if parameter_value REFERENCES the
-- condition rather than copying its predicate — T2 asserts exactly that.
--
-- Runs in a transaction and ROLLBACKs, so it is safe against the deployed project.
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-1111111111cc','param@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name, platforms)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000cc','11111111-1111-1111-1111-1111111111cc','app-param','App Param','{android,ios}');

DO $$
DECLARE
  app     uuid := 'aaaaaaaa-0000-0000-0000-0000000000cc';
  p_flag  uuid;
  p_limit uuid;
  p_theme uuid;
  c_beta  uuid;
  c_ios   uuid;
  res     jsonb;
  n       int;
BEGIN
  -- ── a typed parameter with a default ───────────────────────────────────────
  INSERT INTO public.parameter (app_id, key, type, default_value)
  VALUES (app, 'welcome_banner_enabled', 'boolean', 'false'::jsonb) RETURNING id INTO p_flag;

  -- The type is enforced, not decorative: a boolean parameter holding "yes" would reach a
  -- device as a string and `getBoolean` would have to guess.
  BEGIN
    INSERT INTO public.parameter (app_id, key, type, default_value)
    VALUES (app, 'bad_type', 'boolean', '"yes"'::jsonb);
    RAISE EXCEPTION 'FAIL: a boolean parameter accepted a string default';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ── two named conditions ───────────────────────────────────────────────────
  INSERT INTO public.condition (app_id, name, predicate, priority)
  VALUES (app, 'Android beta', '{"platforms":["android"],"min_app_version":"4.0.0"}'::jsonb, 10)
  RETURNING id INTO c_beta;
  INSERT INTO public.condition (app_id, name, predicate, priority)
  VALUES (app, 'iOS users', '{"platforms":["ios"]}'::jsonb, 20)
  RETURNING id INTO c_ios;

  INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority)
  VALUES (p_flag, c_beta, 'true'::jsonb, 1);
  INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority)
  VALUES (p_flag, c_ios,  'false'::jsonb, 2);

  -- Ties cannot exist: two overrides at the same priority would make "first match wins"
  -- depend on row order, which is not a decision anyone made.
  BEGIN
    INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority)
    VALUES (p_flag, c_ios, 'true'::jsonb, 1);
    RAISE EXCEPTION 'FAIL: a duplicate (parameter, priority) was accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ── resolution ─────────────────────────────────────────────────────────────
  -- An Android 4.3 caller matches "Android beta" (priority 1) and gets true.
  res := public.resolve_parameters(app, '{"platform":"android","app_version":"4.3.0"}'::jsonb);
  IF res->>'welcome_banner_enabled' <> 'true' THEN
    RAISE EXCEPTION 'FAIL: android beta resolved to %, expected true', res->>'welcome_banner_enabled';
  END IF;

  -- Exactly ONE value per key. A map cannot hold two, but the resolver must not emit a key
  -- it has no value for either.
  SELECT count(*) INTO n FROM jsonb_object_keys(res);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: resolver emitted % keys, expected 1', n; END IF;

  -- An iOS caller matches only "iOS users" and gets false.
  res := public.resolve_parameters(app, '{"platform":"ios","app_version":"4.3.0"}'::jsonb);
  IF res->>'welcome_banner_enabled' <> 'false' THEN
    RAISE EXCEPTION 'FAIL: ios resolved to %, expected false', res->>'welcome_banner_enabled';
  END IF;

  -- A caller matching NO condition falls back to the parameter's own default.
  res := public.resolve_parameters(app, '{"platform":"web","app_version":"1.0.0"}'::jsonb);
  IF res->>'welcome_banner_enabled' <> 'false' THEN
    RAISE EXCEPTION 'FAIL: unmatched audience did not fall back to the default';
  END IF;

  -- An android caller BELOW the condition's min_app_version must not match it.
  res := public.resolve_parameters(app, '{"platform":"android","app_version":"3.9.0"}'::jsonb);
  IF res->>'welcome_banner_enabled' <> 'false' THEN
    RAISE EXCEPTION 'FAIL: min_app_version was not honoured';
  END IF;

  -- ── T2: a condition is REFERENCED, never copied ────────────────────────────
  INSERT INTO public.parameter (app_id, key, type, default_value)
  VALUES (app, 'max_uploads', 'number', '5'::jsonb) RETURNING id INTO p_limit;
  INSERT INTO public.parameter (app_id, key, type, default_value)
  VALUES (app, 'theme', 'string', '"light"'::jsonb) RETURNING id INTO p_theme;

  INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority)
  VALUES (p_limit, c_beta, '50'::jsonb, 1);
  INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority)
  VALUES (p_theme, c_beta, '"dark"'::jsonb, 1);

  -- One predicate row backs all three attachments.
  SELECT count(*) INTO n FROM public.condition WHERE app_id = app;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 condition rows, got % (predicates are being copied)', n; END IF;

  res := public.resolve_parameters(app, '{"platform":"android","app_version":"4.3.0"}'::jsonb);
  IF res->>'max_uploads' <> '50' OR res->>'theme' <> 'dark' THEN
    RAISE EXCEPTION 'FAIL: the shared condition did not apply to every attached parameter';
  END IF;

  -- Edit the condition ONCE; all three parameters must follow. This is the whole point of
  -- naming a condition instead of repeating a predicate.
  UPDATE public.condition SET predicate = '{"platforms":["ios"]}'::jsonb WHERE id = c_beta;
  res := public.resolve_parameters(app, '{"platform":"android","app_version":"4.3.0"}'::jsonb);
  IF res->>'max_uploads' <> '5' OR res->>'theme' <> 'light' THEN
    RAISE EXCEPTION 'FAIL: editing the condition did not change every parameter that uses it';
  END IF;

  RAISE NOTICE 'PASS: typed parameters, priority ties refused, resolution order and condition reuse hold';
END $$;

ROLLBACK;
