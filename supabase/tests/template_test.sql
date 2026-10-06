DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.template WHERE is_builtin;
  IF n <> 15 THEN RAISE EXCEPTION 'FAIL: expected 15 builtin templates, found %', n; END IF;

  -- feature_flag renders nothing: the model must not assume every config has a surface.
  IF (SELECT renders_ui FROM public.template WHERE id = 'feature_flag') THEN
    RAISE EXCEPTION 'FAIL: feature_flag must have renders_ui = false';
  END IF;
  IF (SELECT allowed_displays FROM public.template WHERE id = 'feature_flag') <> ARRAY['none'] THEN
    RAISE EXCEPTION 'FAIL: feature_flag must only allow display none';
  END IF;

  -- policy_update needs acknowledgement, not dismissal: a terms change a user can swipe
  -- away has not been accepted.
  IF NOT (SELECT requires_ack FROM public.template WHERE id = 'policy_update') THEN
    RAISE EXCEPTION 'FAIL: policy_update must require ack';
  END IF;

  -- every template's payload_schema must be a usable JSON Schema object, or the
  -- dashboard's generated form has nothing to build from
  IF EXISTS (SELECT 1 FROM public.template
             WHERE payload_schema->>'type' IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'FAIL: a template payload_schema is not type=object';
  END IF;

  -- a UI template with no allowed display is unauthorable
  IF EXISTS (SELECT 1 FROM public.template
             WHERE renders_ui AND cardinality(allowed_displays) = 0) THEN
    RAISE EXCEPTION 'FAIL: a UI template has no allowed_displays';
  END IF;

  RAISE NOTICE 'PASS: template registry seeded and coherent';
END $$;

-- ============================================================
-- Display-token closure (migration 010)
-- ============================================================
-- The SDK's DisplayType knows dialog/fullscreen/banner/bottom_sheet and falls back to
-- DIALOG for anything else, so a template declaring an unrenderable display would draw the
-- wrong thing on device with nothing reporting it. Two builtins shipped `inline`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.template WHERE 'inline' = ANY(allowed_displays)) THEN
    RAISE EXCEPTION 'FAIL: a template still declares inline, which the SDK renders as a DIALOG';
  END IF;

  -- The constraint, not just the cleanup: a template created through the API must be
  -- refused too, which is why this is in the database and not in the dashboard.
  BEGIN
    UPDATE public.template SET allowed_displays = ARRAY['inline'] WHERE id = 'information';
    RAISE EXCEPTION 'FAIL: template_displays_renderable permitted an unrenderable display';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- `none` must stay legal — it is how a value-only template says it draws nothing.
  IF NOT EXISTS (SELECT 1 FROM public.template WHERE id = 'feature_flag' AND allowed_displays = ARRAY['none']) THEN
    RAISE EXCEPTION 'FAIL: feature_flag no longer declares {none}; the closure constraint has broken value-only templates';
  END IF;

  RAISE NOTICE 'PASS: every declared display is one the SDK can render';
END $$;
