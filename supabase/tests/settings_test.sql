-- Phase 04 / T1 — server-delivered SDK settings.
--
-- Today the fetch interval is a compile-time constant in the consumer app, so a server under
-- load cannot ask clients to back off, and there is no way to disable a misbehaving
-- integration without shipping an app release through two review queues.
--
-- The bounds are the point of this test. A `fetch_interval_seconds = 1` row would reach every
-- device and then could not be withdrawn faster than the interval it just set — the operator
-- would have armed a self-inflicted DDoS with no way back. Bounds live in the DATABASE, not
-- the dashboard form, because an API caller bypasses the form.
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-1111111111dd','set@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000dd','11111111-1111-1111-1111-1111111111dd','app-set','App Settings');

DO $$
DECLARE
  app uuid := 'aaaaaaaa-0000-0000-0000-0000000000dd';
  n   int;
BEGIN
  -- Creating the app must have created its settings row. An ABSENT row would force the edge
  -- function to decide whether "no settings" means defaults or means disabled, and that
  -- ambiguity ends with a kill switch read as "off" for an app nobody touched.
  SELECT count(*) INTO n FROM public.app_settings WHERE app_id = app;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: creating an app did not create its settings row (got %)', n; END IF;

  -- G-6c — a 1-second interval is refused.
  BEGIN
    UPDATE public.app_settings SET fetch_interval_seconds = 1 WHERE app_id = app;
    RAISE EXCEPTION 'FAIL: fetch_interval_seconds = 1 was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- A sane interval is accepted.
  UPDATE public.app_settings SET fetch_interval_seconds = 900 WHERE app_id = app;
  IF (SELECT fetch_interval_seconds FROM public.app_settings WHERE app_id = app) <> 900 THEN
    RAISE EXCEPTION 'FAIL: a 900s interval was not accepted';
  END IF;

  -- One settings row per app. Two would make "which one is live" a coin flip.
  BEGIN
    INSERT INTO public.app_settings (app_id, fetch_interval_seconds) VALUES (app, 1800);
    RAISE EXCEPTION 'FAIL: a second settings row was accepted for one app';
  EXCEPTION
    WHEN unique_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- An absurd upper bound is refused too: a 90-day interval is indistinguishable from the
  -- SDK being switched off, except that it looks like a working configuration.
  BEGIN
    UPDATE public.app_settings SET fetch_interval_seconds = 7776000 WHERE app_id = app;
    RAISE EXCEPTION 'FAIL: a 90-day interval was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- `enabled` defaults TRUE: a newly created app must not be born switched off.
  IF NOT (SELECT enabled FROM public.app_settings WHERE app_id = app) THEN
    RAISE EXCEPTION 'FAIL: app_settings.enabled defaulted to false';
  END IF;

  -- The kill switch is a plain boolean an operator can set.
  UPDATE public.app_settings SET enabled = false WHERE app_id = app;
  IF (SELECT enabled FROM public.app_settings WHERE app_id = app) THEN
    RAISE EXCEPTION 'FAIL: the kill switch did not take';
  END IF;

  RAISE NOTICE 'PASS: settings bounds, single-row-per-app and the kill switch hold';
END $$;

ROLLBACK;
