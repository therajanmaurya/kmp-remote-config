-- Phase 05 / T1 — rollout columns and their bounds.
--
-- The BUCKETING properties (stability, per-config independence, additivity) are asserted in
-- `audience_rollout_test.ts` against the shipped TypeScript implementation, not here. Bucketing
-- runs in the edge function because the device id arrives in a request header, and a SQL copy
-- of the hash would be a SECOND implementation that could pass this file while the code that
-- actually serves devices fails. Phase 03 made the same call in the opposite direction: the
-- test goes where the one real implementation lives.
--
-- What belongs here is what the database owns: the column, and bounds a dashboard form cannot
-- be trusted to enforce because an API caller bypasses it.
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-1111111111ee','roll@example.test');
INSERT INTO public.app (id, owner_id, slug, display_name)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000ee','11111111-1111-1111-1111-1111111111ee','app-roll','App Rollout');

DO $$
DECLARE
  app uuid := 'aaaaaaaa-0000-0000-0000-0000000000ee';
  cid uuid;
BEGIN
  -- A config is fully rolled out unless someone says otherwise. Defaulting to 0 would make
  -- every newly authored config invisible to everyone, which reads as "the product is broken".
  INSERT INTO public.config (app_id, template_id, payload, display)
  VALUES (app, 'announcement', '{"title":"t","body":"b"}', 'dialog') RETURNING id INTO cid;
  IF (SELECT rollout_percentage FROM public.config WHERE id = cid) <> 100 THEN
    RAISE EXCEPTION 'FAIL: rollout_percentage did not default to 100';
  END IF;

  UPDATE public.config SET rollout_percentage = 10 WHERE id = cid;
  IF (SELECT rollout_percentage FROM public.config WHERE id = cid) <> 10 THEN
    RAISE EXCEPTION 'FAIL: a 10%% rollout was not stored';
  END IF;

  -- Out-of-range values are refused. 101% is a typo; -1 is a sign error. Either reaching the
  -- snapshot would make the served audience undefined.
  BEGIN
    UPDATE public.config SET rollout_percentage = 101 WHERE id = cid;
    RAISE EXCEPTION 'FAIL: rollout_percentage = 101 was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.config SET rollout_percentage = -1 WHERE id = cid;
    RAISE EXCEPTION 'FAIL: rollout_percentage = -1 was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- 0 is legal and distinct from disabling: "published, reaching nobody yet" is the state a
  -- staged rollout starts from.
  UPDATE public.config SET rollout_percentage = 0 WHERE id = cid;

  -- A cohort is a free-form label an operator targets; empty means "no cohort restriction".
  UPDATE public.config SET cohort = 'beta' WHERE id = cid;
  IF (SELECT cohort FROM public.config WHERE id = cid) <> 'beta' THEN
    RAISE EXCEPTION 'FAIL: cohort was not stored';
  END IF;

  RAISE NOTICE 'PASS: rollout_percentage defaults to 100, bounds hold, cohort stores';
END $$;

ROLLBACK;
