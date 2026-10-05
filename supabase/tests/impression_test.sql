BEGIN;
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','a@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','app-a','App A');
INSERT INTO public.config (id, app_id, template_id, payload, display)
VALUES ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'announcement','{"title":"t","body":"b"}','dialog');

DO $$
DECLARE applied boolean; c int;
BEGIN
  -- A genuine second showing MUST count twice…
  PERFORM public.record_event('cccccccc-0000-0000-0000-000000000001','dev-1','impression','evt-1');
  PERFORM public.record_event('cccccccc-0000-0000-0000-000000000001','dev-1','impression','evt-2');
  SELECT count INTO c FROM public.impression
   WHERE config_id='cccccccc-0000-0000-0000-000000000001' AND device_id='dev-1';
  IF c <> 2 THEN RAISE EXCEPTION 'FAIL: two distinct impressions counted % times', c; END IF;

  -- …while a network RETRY of the same event must not. Deduping on
  -- (config_id, device_id, type) instead would make every impression after the first
  -- invisible and silently cap max_impressions at 1.
  applied := public.record_event('cccccccc-0000-0000-0000-000000000001','dev-1','impression','evt-2');
  IF applied THEN RAISE EXCEPTION 'FAIL: duplicate event_id was applied'; END IF;
  SELECT count INTO c FROM public.impression
   WHERE config_id='cccccccc-0000-0000-0000-000000000001' AND device_id='dev-1';
  IF c <> 2 THEN RAISE EXCEPTION 'FAIL: retry inflated count to %', c; END IF;

  -- The same event_id on a DIFFERENT device is a different event.
  applied := public.record_event('cccccccc-0000-0000-0000-000000000001','dev-2','impression','evt-2');
  IF NOT applied THEN RAISE EXCEPTION 'FAIL: cross-device event_id was treated as duplicate'; END IF;

  -- dismiss / ack are state transitions
  PERFORM public.record_event('cccccccc-0000-0000-0000-000000000001','dev-1','dismiss','evt-3');
  IF NOT (SELECT dismissed FROM public.impression
          WHERE config_id='cccccccc-0000-0000-0000-000000000001' AND device_id='dev-1') THEN
    RAISE EXCEPTION 'FAIL: dismiss did not set dismissed';
  END IF;
  PERFORM public.record_event('cccccccc-0000-0000-0000-000000000001','dev-1','ack','evt-4');
  IF (SELECT acked_at FROM public.impression
      WHERE config_id='cccccccc-0000-0000-0000-000000000001' AND device_id='dev-1') IS NULL THEN
    RAISE EXCEPTION 'FAIL: ack did not set acked_at';
  END IF;

  RAISE NOTICE 'PASS: impression dedupe + transitions hold';
END $$;
ROLLBACK;
