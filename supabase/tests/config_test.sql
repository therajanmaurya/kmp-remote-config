BEGIN;
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','a@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','app-a','App A');

DO $$
DECLARE cid uuid;
BEGIN
  -- is_enabled must default FALSE: dashboard authoring means a row exists while it is
  -- still being written, and a default-on row is live the moment it is inserted.
  INSERT INTO public.config (app_id, template_id, payload, display)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','announcement',
          '{"title":"Hi","body":"There"}','dialog')
  RETURNING id INTO cid;
  IF (SELECT is_enabled FROM public.config WHERE id = cid) THEN
    RAISE EXCEPTION 'FAIL: config.is_enabled defaulted to true';
  END IF;

  -- display must be one the template permits, or an operator can author a config the
  -- client cannot render and find out from a user
  BEGIN
    INSERT INTO public.config (app_id, template_id, payload, display)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','announcement','{"title":"x","body":"y"}','fullscreen');
    RAISE EXCEPTION 'FAIL: display outside allowed_displays accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- policy_update requires ack ⇒ it may not also be dismissible
  BEGIN
    INSERT INTO public.config (app_id, template_id, payload, display, is_dismissible)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','policy_update',
            '{"title":"T","summary":"S","policy_url":"https://e.test/p","effective_at":"2026-11-01T00:00:00Z"}',
            'fullscreen', true);
    RAISE EXCEPTION 'FAIL: requires_ack template accepted is_dismissible=true';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- …and is accepted when not dismissible
  INSERT INTO public.config (app_id, template_id, payload, display, is_dismissible)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','policy_update',
          '{"title":"T","summary":"S","policy_url":"https://e.test/p","effective_at":"2026-11-01T00:00:00Z"}',
          'fullscreen', false);

  RAISE NOTICE 'PASS: config invariants hold';
END $$;
ROLLBACK;
