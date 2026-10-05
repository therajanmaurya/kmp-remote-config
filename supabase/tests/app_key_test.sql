BEGIN;
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','a@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','app-a','App A');

DO $$
DECLARE k text;
BEGIN
  k := public.generate_publishable_key('live');
  IF k !~ '^pk_live_[A-Za-z0-9]{32}$' THEN
    RAISE EXCEPTION 'FAIL: live key shape wrong: %', k;
  END IF;
  IF public.generate_publishable_key('test') !~ '^pk_test_[A-Za-z0-9]{32}$' THEN
    RAISE EXCEPTION 'FAIL: test key shape wrong';
  END IF;
  IF public.generate_publishable_key('live') = k THEN
    RAISE EXCEPTION 'FAIL: two calls produced the same key';
  END IF;

  -- attestation_policy=required is impossible on a platform with no attestation API:
  -- every request from it would fail with no way to satisfy the check.
  BEGIN
    INSERT INTO public.app_key (app_id, key, environment, platform, attestation_policy)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', public.generate_publishable_key('live'),
            'live', 'desktop', 'required');
    RAISE EXCEPTION 'FAIL: required attestation accepted on desktop';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- android IS allowed to require it
  INSERT INTO public.app_key (app_id, key, environment, platform, attestation_policy, bundle_id, cert_digests)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', public.generate_publishable_key('live'),
          'live', 'android', 'required', 'com.example.app',
          ARRAY['AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99']);

  RAISE NOTICE 'PASS: app_key invariants hold';
END $$;
ROLLBACK;
