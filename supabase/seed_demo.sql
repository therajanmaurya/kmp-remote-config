-- =============================================================================
-- seed_demo.sql — the demo app from the dashboard mockups
-- =============================================================================
-- Operator-approved 2026-10-07: the mockups' demo data is the reference, so this seeds exactly
-- what they show — "Lumen Photos" with welcome_banner_enabled / max_upload_mb / checkout_copy /
-- feature_flags / sync_interval_seconds, and the Android beta / iOS 4.2+ / EU region / Slow
-- rollout conditions.
--
-- WHY THIS EXISTS: the deployed plane had 15 builtin templates and zero apps, so signing in
-- landed on an empty list and none of the control-plane surfaces had anything to show. An empty
-- dashboard is indistinguishable from a broken one.
--
-- IDEMPOTENT: safe to re-run. Owned by the project's existing operator account rather than a
-- fabricated user, so it appears for whoever actually signs in.
--
-- NOT A FIXTURE FOR TESTS. `e2e_sdk_contract.sh` seeds and removes its own sentinel rows; this
-- is demo content a human looks at. Remove it with the DELETE at the bottom of this file.
-- =============================================================================

DO $$
DECLARE
    v_owner  uuid;
    v_app    uuid;
    p_banner uuid;
    p_upload uuid;
    p_copy   uuid;
    p_flags  uuid;
    p_sync   uuid;
    c_beta   uuid;
    c_ios    uuid;
    c_eu     uuid;
    c_slow   uuid;
BEGIN
    -- The real operator, not an invented one: a demo app owned by a user who cannot sign in
    -- would be invisible to everybody.
    SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'no auth user exists to own the demo app — sign in once first';
    END IF;

    INSERT INTO public.app (owner_id, slug, display_name, platforms)
    VALUES (v_owner, 'lumen-photos', 'Lumen Photos', '{android,ios}')
    ON CONFLICT (owner_id, slug) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id INTO v_app;

    -- ── conditions (mockup 03) ───────────────────────────────────────────────
    INSERT INTO public.condition (app_id, name, predicate, priority) VALUES
      (v_app, 'Android beta users', '{"platforms":["android"],"min_app_version":"4.0.0"}'::jsonb, 10),
      (v_app, 'iOS 4.2 and newer',  '{"platforms":["ios"],"min_app_version":"4.2.0"}'::jsonb, 20),
      (v_app, 'EU region',          '{"platforms":["android","ios"]}'::jsonb, 30),
      (v_app, 'Slow rollout',       '{"platforms":["android"]}'::jsonb, 40)
    ON CONFLICT (app_id, name) DO UPDATE SET predicate = EXCLUDED.predicate, priority = EXCLUDED.priority;

    SELECT id INTO c_beta FROM public.condition WHERE app_id = v_app AND name = 'Android beta users';
    SELECT id INTO c_ios  FROM public.condition WHERE app_id = v_app AND name = 'iOS 4.2 and newer';
    SELECT id INTO c_eu   FROM public.condition WHERE app_id = v_app AND name = 'EU region';
    SELECT id INTO c_slow FROM public.condition WHERE app_id = v_app AND name = 'Slow rollout';

    -- ── parameters (mockups 01 + 02) ─────────────────────────────────────────
    INSERT INTO public.parameter (app_id, key, type, default_value, description) VALUES
      (v_app, 'welcome_banner_enabled', 'boolean', 'false'::jsonb, 'Show the first-run welcome banner'),
      (v_app, 'max_upload_mb',          'number',  '50'::jsonb,    'Per-photo upload ceiling'),
      (v_app, 'checkout_copy',          'string',  '"Proceed to checkout"'::jsonb, 'Primary checkout CTA'),
      (v_app, 'feature_flags',          'json',    '{}'::jsonb,    'Grouped experimental toggles'),
      (v_app, 'sync_interval_seconds',  'number',  '900'::jsonb,   'Background library sync cadence')
    ON CONFLICT (app_id, key) DO UPDATE
      SET type = EXCLUDED.type, default_value = EXCLUDED.default_value, description = EXCLUDED.description;

    SELECT id INTO p_banner FROM public.parameter WHERE app_id = v_app AND key = 'welcome_banner_enabled';
    SELECT id INTO p_upload FROM public.parameter WHERE app_id = v_app AND key = 'max_upload_mb';
    SELECT id INTO p_copy   FROM public.parameter WHERE app_id = v_app AND key = 'checkout_copy';
    SELECT id INTO p_flags  FROM public.parameter WHERE app_id = v_app AND key = 'feature_flags';
    SELECT id INTO p_sync   FROM public.parameter WHERE app_id = v_app AND key = 'sync_interval_seconds';

    -- ── overrides ────────────────────────────────────────────────────────────
    -- welcome_banner_enabled carries TWO, exactly as mockup 02 shows, so the evaluation
    -- precedence list has something real to order and the live evaluator has a winner to name.
    INSERT INTO public.parameter_value (parameter_id, condition_id, value, priority) VALUES
      (p_banner, c_beta, 'true'::jsonb,  1),
      (p_banner, c_ios,  'true'::jsonb,  2),
      (p_upload, c_beta, '200'::jsonb,   1),
      (p_copy,   c_eu,   '"Continue to payment"'::jsonb, 1),
      (p_flags,  c_beta, '{"new_editor":true,"raw_export":true}'::jsonb, 1),
      (p_flags,  c_slow, '{"new_editor":true}'::jsonb, 2),
      (p_sync,   c_slow, '1800'::jsonb,  1)
    ON CONFLICT (parameter_id, condition_id) DO UPDATE SET value = EXCLUDED.value;

    -- ── a UI config, so the Configs surface is not empty either ──────────────
    INSERT INTO public.config (app_id, template_id, payload, display, screens, platforms,
                               priority, is_enabled, rollout_percentage)
    VALUES (v_app, 'announcement',
            '{"title":"New: raw export","body":"Export full-resolution originals from any album."}'::jsonb,
            'dialog', '{}', '{android,ios}', 10, true, 100)
    ON CONFLICT DO NOTHING;

    -- ── a publishable test key, so the preview and SDK have something to use ──
    INSERT INTO public.app_key (app_id, key, label, environment, platform, bundle_id, attestation_policy)
    VALUES (v_app, 'rck_test_LUMENDEMO000000000000000000', 'demo test key', 'test', 'android',
            'com.lumen.photos', 'off')
    ON CONFLICT (key) DO NOTHING;

    -- ── publish, twice, so Activity shows real history ───────────────────────
    -- A single version would leave the history page with one row and no rollback affordance,
    -- which is the half of Phase 02 an operator most needs to see working.
    --
    -- Published AS THE OWNER, not as postgres. `publish()` checks membership through
    -- auth.uid(), which is NULL for a superuser psql session — so the seed takes the same
    -- route the dashboard does rather than the routine being loosened to accommodate a seed.
    -- This also makes `published_by` a real user, so Activity attributes the revisions.
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    PERFORM public.publish(v_app);
    RESET ROLE;
    UPDATE public.parameter SET default_value = '100'::jsonb WHERE id = p_upload;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.publish(v_app);
    RESET ROLE;

    RAISE NOTICE 'seeded Lumen Photos: 5 parameters, 4 conditions, 7 overrides, 1 config, 2 versions';
END $$;

-- To remove the demo app and everything under it (cascades):
--   DELETE FROM public.app a WHERE a.slug = 'lumen-photos';
