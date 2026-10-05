BEGIN;
-- Two users, created directly in auth.users (the dashboard will do this via GoTrue).
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

INSERT INTO public.app (id, owner_id, slug, display_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'app-a', 'App A');

DO $$
BEGIN
  -- The owner trigger must have created the membership row. Without it, every policy
  -- (which resolves through app_member) would deny the creator access to their own app.
  IF NOT EXISTS (SELECT 1 FROM public.app_member
                 WHERE app_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                   AND user_id = '11111111-1111-1111-1111-111111111111'
                   AND role = 'owner') THEN
    RAISE EXCEPTION 'FAIL: owner membership row was not auto-created';
  END IF;

  -- slug is unique PER OWNER, not globally: two users may both have "app-a".
  INSERT INTO public.app (owner_id, slug, display_name)
  VALUES ('22222222-2222-2222-2222-222222222222', 'app-a', 'App A of B');

  -- but the SAME owner may not reuse a slug
  BEGIN
    INSERT INTO public.app (owner_id, slug, display_name)
    VALUES ('11111111-1111-1111-1111-111111111111', 'app-a', 'dupe');
    RAISE EXCEPTION 'FAIL: duplicate (owner_id, slug) was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS: app + app_member invariants hold';
END $$;
ROLLBACK;
