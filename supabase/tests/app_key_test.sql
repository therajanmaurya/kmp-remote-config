BEGIN;
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','a@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','app-a','App A');

DO $$
DECLARE k text;
BEGIN
  k := public.generate_publishable_key('live');
  IF k !~ '^rck_live_[A-Za-z0-9]{32}$' THEN
    RAISE EXCEPTION 'FAIL: live key shape wrong: %', k;
  END IF;
  IF public.generate_publishable_key('test') !~ '^rck_test_[A-Za-z0-9]{32}$' THEN
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

  -- M5: the key prefix must agree with the environment column, or a row can claim
  -- rck_test_… while being environment='live' and the dashboard shows a contradiction.
  BEGIN
    INSERT INTO public.app_key (app_id, key, environment)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', public.generate_publishable_key('test'), 'live');
    RAISE EXCEPTION 'FAIL: a test-prefixed key was accepted as environment=live';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- M5: uniform base62. A plain `% 62` over 256 byte values makes the first 8 alphabet
  -- characters ~25% likelier; irrelevant for a deliberately-public key, but the pattern
  -- gets copied somewhere it matters. Sample the leading char of many keys and assert no
  -- single character dominates — with 400 draws over 62 symbols, a uniform generator gives
  -- ~6.5 each and a biased one gives ~10 for the low 8.
  DECLARE
    worst int;
  BEGIN
    CREATE TEMP TABLE _k(c text) ON COMMIT DROP;
    FOR i IN 1..400 LOOP
      INSERT INTO _k VALUES (substr(public.generate_publishable_key('live'), 10, 1));
    END LOOP;
    SELECT max(n) INTO worst FROM (SELECT count(*) AS n FROM _k GROUP BY c) q;
    IF worst > 22 THEN
      RAISE EXCEPTION 'FAIL: base62 looks biased — one leading char appeared % times in 400', worst;
    END IF;
  END;

  RAISE NOTICE 'PASS: app_key invariants hold';
END $$;
ROLLBACK;
