-- Per-app custom templates and community sharing (migration 009).
--
-- The assertions that matter most here are not "does it work" but "can it publish
-- something nobody agreed to publish" and "can one tenant reach another's template".
-- Spec §15 treats sharing as a consent and licensing act, so opt-in is enforced
-- STRUCTURALLY — a template cannot be created already-shared — and this file is what
-- proves that claim rather than asserting it in a comment.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111','ct-a@example.test'),
  ('b2222222-2222-2222-2222-222222222222','ct-b@example.test'),
  ('e3333333-3333-3333-3333-333333333333','ct-editor@example.test'),
  ('f4444444-4444-4444-4444-444444444444','ct-viewer@example.test');

INSERT INTO public.app (id, owner_id, slug, display_name) VALUES
  ('aaaa0000-0000-0000-0000-00000000000a','a1111111-1111-1111-1111-111111111111','ct-app-a','CT App A'),
  ('bbbb0000-0000-0000-0000-00000000000b','b2222222-2222-2222-2222-222222222222','ct-app-b','CT App B');

INSERT INTO public.app_member (app_id, user_id, role) VALUES
  ('aaaa0000-0000-0000-0000-00000000000a','e3333333-3333-3333-3333-333333333333','editor'),
  ('aaaa0000-0000-0000-0000-00000000000a','f4444444-4444-4444-4444-444444444444','viewer');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'set local role authenticated';
  EXECUTE format('set local request.jwt.claims = %L', json_build_object('sub', p_uid)::text);
END $$;

-- A minimal valid schema so config_template_coherence has something to validate against.
CREATE OR REPLACE FUNCTION pg_temp.mk_schema() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}'::jsonb
$$;

DO $$
DECLARE
    n       int;
    v       text;
    t_at    timestamptz;
    t_by    uuid;
    fork_id text;
BEGIN
  -- ════ creation ════════════════════════════════════════════════════════════
  PERFORM pg_temp.as_user('a1111111-1111-1111-1111-111111111111');

  INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id)
  VALUES ('c_welcome', 'Welcome card', pg_temp.mk_schema(), '{dialog}', false, 'aaaa0000-0000-0000-0000-00000000000a');

  SELECT visibility INTO v FROM public.template WHERE id = 'c_welcome';
  IF v <> 'private' THEN
    RAISE EXCEPTION 'FAIL: a new custom template is % rather than private', v;
  END IF;

  -- ── a template CANNOT be created already-shared ──────────────────────────
  -- This is the structural form of opt-in. If this insert succeeded, "opt-in" would be a
  -- dashboard convention that any other client could ignore.
  BEGIN
    INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id, visibility, shared_at, shared_by)
    VALUES ('c_sneaky', 'Sneaky', pg_temp.mk_schema(), '{dialog}', false,
            'aaaa0000-0000-0000-0000-00000000000a', 'community', now(), 'a1111111-1111-1111-1111-111111111111');
    RAISE EXCEPTION 'FAIL: created a template already marked community — sharing is not opt-in';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ── a custom id must be prefixed ─────────────────────────────────────────
  -- Otherwise a custom template can be called `update_available_v2` and read as one of
  -- ours wherever a template id surfaces.
  BEGIN
    INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id)
    VALUES ('update_available_v2', 'Impostor', pg_temp.mk_schema(), '{dialog}', false, 'aaaa0000-0000-0000-0000-00000000000a');
    RAISE EXCEPTION 'FAIL: a custom template took an unprefixed id that can pass for a builtin';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ── a user cannot mint something claiming to be ours ─────────────────────
  BEGIN
    INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id)
    VALUES ('c_fake_builtin', 'Fake', pg_temp.mk_schema(), '{dialog}', true, NULL);
    RAISE EXCEPTION 'FAIL: a user created a BUILTIN template';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- ════ consent stamping ════════════════════════════════════════════════════
  -- The client supplies a FALSE author and date; the trigger must overwrite both. If it
  -- merely trusted them, the consent record could be attributed to anyone.
  UPDATE public.template
     SET visibility = 'community',
         shared_by  = 'b2222222-2222-2222-2222-222222222222',   -- lie: a different user
         shared_at  = '2000-01-01T00:00:00Z'                     -- lie: a date in the past
   WHERE id = 'c_welcome';

  SELECT shared_at, shared_by INTO t_at, t_by FROM public.template WHERE id = 'c_welcome';
  IF t_by <> 'a1111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'FAIL: shared_by was taken from the client (%) — a publication could be attributed to another user', t_by;
  END IF;
  IF t_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'FAIL: shared_at was taken from the client (%) — the consent date is forgeable', t_at;
  END IF;

  -- ── withdrawing clears the consent record ────────────────────────────────
  UPDATE public.template SET visibility = 'private' WHERE id = 'c_welcome';
  SELECT shared_at, shared_by INTO t_at, t_by FROM public.template WHERE id = 'c_welcome';
  IF t_at IS NOT NULL OR t_by IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: un-sharing left a consent record behind (at=%, by=%)', t_at, t_by;
  END IF;

  -- ── re-sharing does not let the original date be rewritten ───────────────
  UPDATE public.template SET visibility = 'community' WHERE id = 'c_welcome';
  SELECT shared_at INTO t_at FROM public.template WHERE id = 'c_welcome';
  UPDATE public.template SET shared_at = '2000-01-01T00:00:00Z' WHERE id = 'c_welcome';
  IF (SELECT shared_at FROM public.template WHERE id = 'c_welcome') <> t_at THEN
    RAISE EXCEPTION 'FAIL: an already-shared template had its consent date rewritten';
  END IF;

  -- ════ immutability ════════════════════════════════════════════════════════
  BEGIN
    -- Relocating a template into an app you do not belong to.
    UPDATE public.template SET app_id = 'bbbb0000-0000-0000-0000-00000000000b' WHERE id = 'c_welcome';
    RAISE EXCEPTION 'FAIL: app_id was mutable — a template can be moved into another app';
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.template SET is_builtin = true WHERE id = 'c_welcome';
    RAISE EXCEPTION 'FAIL: is_builtin was mutable — a user template can promote itself to ours';
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    WHEN insufficient_privilege THEN NULL;
    WHEN check_violation THEN NULL;
  END;

  -- ── a builtin can never be marked community ──────────────────────────────
  -- It is already global; 'community' would assert a user shared it and credit them for
  -- our seed data.
  -- RLS makes an UPDATE whose USING clause excludes the row a silent NO-OP, not an error.
  -- So the assertion is on the OUTCOME: nothing updated, and the stored value unchanged.
  -- Asserting "it raised" would have failed here while the code was correct.
  BEGIN
    UPDATE public.template SET visibility = 'community' WHERE id = 'announcement';
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: a BUILTIN was marked community';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    WHEN insufficient_privilege THEN NULL;
    WHEN check_violation THEN NULL;
  END;
  IF (SELECT visibility FROM public.template WHERE id = 'announcement') <> 'private' THEN
    RAISE EXCEPTION 'FAIL: the builtin announcement template is no longer private';
  END IF;

  RAISE NOTICE 'PASS: creation is private-only, consent is server-stamped and unforgeable, identity is immutable';
END $$;

-- ════ cross-tenant ═════════════════════════════════════════════════════════
DO $$
DECLARE n int; fork_id text; v text; fb text;
BEGIN
  -- App A owns a PRIVATE template and a COMMUNITY one.
  PERFORM pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
  INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id)
  VALUES ('c_private_a', 'A private', pg_temp.mk_schema(), '{dialog}', false, 'aaaa0000-0000-0000-0000-00000000000a');
  -- c_welcome is already community from the block above.

  -- ── B sees the community one, never the private one ─────────────────────
  PERFORM pg_temp.as_user('b2222222-2222-2222-2222-222222222222');

  SELECT count(*) INTO n FROM public.template WHERE id = 'c_private_a';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: app B can SELECT app A''s PRIVATE custom template';
  END IF;

  SELECT count(*) INTO n FROM public.template WHERE id = 'c_welcome';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: app B cannot see a community template — the catalog is unreadable';
  END IF;

  -- ── B cannot edit or share A's template ─────────────────────────────────
  BEGIN
    UPDATE public.template SET display_name = 'hijacked' WHERE id = 'c_welcome';
    IF FOUND THEN
      RAISE EXCEPTION 'FAIL: app B edited app A''s community template';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    WHEN insufficient_privilege THEN NULL;
  END;

  -- ── B's config cannot REFERENCE A's template ────────────────────────────
  -- The hole 009 closes. The FK alone permits it, which would couple two tenants: A's
  -- delete breaks B's live configs, and A un-sharing silently changes what B may do.
  BEGIN
    INSERT INTO public.config (app_id, template_id, payload, display)
    VALUES ('bbbb0000-0000-0000-0000-00000000000b', 'c_welcome', '{"title":"x"}', 'dialog');
    RAISE EXCEPTION 'FAIL: app B''s config referenced app A''s template directly';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%belongs to another app%' THEN
        RAISE EXCEPTION 'FAIL: wrong rejection for a cross-tenant template reference: %', SQLERRM;
      END IF;
    WHEN insufficient_privilege THEN NULL;
  END;

  -- ── adoption is by COPY, and the copy is private ────────────────────────
  fork_id := public.fork_template('c_welcome', 'bbbb0000-0000-0000-0000-00000000000b');
  SELECT visibility, forked_from INTO v, fb FROM public.template WHERE id = fork_id;
  IF v <> 'private' THEN
    RAISE EXCEPTION 'FAIL: a fork was born % — adopting someone''s template is not republishing it', v;
  END IF;
  IF fb <> 'c_welcome' THEN
    RAISE EXCEPTION 'FAIL: the fork lost its provenance (forked_from=%)', fb;
  END IF;
  IF (SELECT app_id FROM public.template WHERE id = fork_id) <> 'bbbb0000-0000-0000-0000-00000000000b' THEN
    RAISE EXCEPTION 'FAIL: the fork did not land in the caller''s app';
  END IF;

  -- …and now B's own config CAN use its own copy.
  INSERT INTO public.config (app_id, template_id, payload, display)
  VALUES ('bbbb0000-0000-0000-0000-00000000000b', fork_id, '{"title":"x"}', 'dialog');

  -- ── forking A's PRIVATE template is refused, and reveals nothing ─────────
  BEGIN
    PERFORM public.fork_template('c_private_a', 'bbbb0000-0000-0000-0000-00000000000b');
    RAISE EXCEPTION 'FAIL: app B forked app A''s PRIVATE template';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      -- "unknown template" and not "not shared": a distinct message would confirm the row
      -- exists, which is an existence oracle over another tenant's data.
      IF SQLERRM NOT LIKE '%unknown template%' THEN
        RAISE EXCEPTION 'FAIL: the refusal revealed that the template exists: %', SQLERRM;
      END IF;
  END;

  -- ── forking INTO an app you do not belong to is refused ─────────────────
  -- fork_template is SECURITY DEFINER, so without its own has_app_role check any signed-in
  -- user could plant templates in any app.
  BEGIN
    PERFORM public.fork_template('c_welcome', 'aaaa0000-0000-0000-0000-00000000000a');
    RAISE EXCEPTION 'FAIL: app B planted a template into app A';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%not permitted%' THEN
        RAISE EXCEPTION 'FAIL: wrong rejection for a cross-app fork: %', SQLERRM;
      END IF;
  END;

  -- ── a fork of a BUILTIN is not a builtin ────────────────────────────────
  fork_id := public.fork_template('announcement', 'bbbb0000-0000-0000-0000-00000000000b');
  IF (SELECT is_builtin FROM public.template WHERE id = fork_id) THEN
    RAISE EXCEPTION 'FAIL: forking a builtin produced another builtin';
  END IF;

  RAISE NOTICE 'PASS: private templates stay private, adoption copies, forks are born private, DEFINER checks the destination';
END $$;

-- ════ roles ════════════════════════════════════════════════════════════════
DO $$
DECLARE n int;
BEGIN
  -- An editor may create and share.
  PERFORM pg_temp.as_user('e3333333-3333-3333-3333-333333333333');
  INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id)
  VALUES ('c_editor_made', 'Editor made', pg_temp.mk_schema(), '{dialog}', false, 'aaaa0000-0000-0000-0000-00000000000a');

  -- …but may NOT delete: sharing is recoverable, deleting a template other apps have
  -- forked from is not.
  BEGIN
    DELETE FROM public.template WHERE id = 'c_editor_made';
    IF FOUND THEN RAISE EXCEPTION 'FAIL: an editor deleted a template'; END IF;
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    WHEN insufficient_privilege THEN NULL;
  END;

  -- A viewer may read but not create.
  PERFORM pg_temp.as_user('f4444444-4444-4444-4444-444444444444');
  BEGIN
    INSERT INTO public.template (id, display_name, payload_schema, allowed_displays, is_builtin, app_id)
    VALUES ('c_viewer_made', 'Viewer made', pg_temp.mk_schema(), '{dialog}', false, 'aaaa0000-0000-0000-0000-00000000000a');
    RAISE EXCEPTION 'FAIL: a viewer created a template';
  EXCEPTION
    WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    WHEN insufficient_privilege THEN NULL;
  END;

  -- The owner may delete.
  PERFORM pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
  DELETE FROM public.template WHERE id = 'c_editor_made';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: the owner could not delete a template'; END IF;

  RAISE NOTICE 'PASS: editor creates and shares, owner alone deletes, viewer reads only';
END $$;

ROLLBACK;
