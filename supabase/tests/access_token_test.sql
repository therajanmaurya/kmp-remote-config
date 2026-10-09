-- access_token — ACCOUNT-level credentials for API + MCP authentication.
--
-- The single most important assertion in this file is that the token is NOT recoverable from
-- the database. `app_key` (003) is deliberately plaintext because a publishable key ships
-- inside a client binary and hashing it would protect nothing. This table is the exact
-- opposite: an access token acts as its owner across every app they can reach, so a database
-- read must not yield a usable credential.

BEGIN;

-- ── fixtures ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app (id, owner_id, slug, display_name, platforms) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'alpha', 'Alpha', ARRAY['android']),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'beta',  'Beta',  ARRAY['android'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_token   text;
  v_id      uuid;
  v_hash    text;
  v_user    uuid;
  v_perms   text[];
  v_apps    uuid[];
  v_prefix  text;
  v_used    timestamptz;
  v_count   int;
BEGIN
  -- ── AT-1 mint returns a usable token exactly once ─────────────────────────────
  SELECT token, id INTO v_token, v_id
    FROM public.access_token_create(
      p_user_id  => '00000000-0000-0000-0000-0000000000a1',
      p_name     => 'ci token',
      p_expires_in_days => 30,
      p_app_ids  => NULL,                      -- NULL = every app the user can reach
      p_permissions => ARRAY['read','write']);

  IF v_token IS NULL OR v_token !~ '^rcp_[A-Za-z0-9]{40}$' THEN
    RAISE EXCEPTION 'FAIL AT-1: minted token has the wrong shape: %', coalesce(v_token,'<null>');
  END IF;

  -- ── AT-2 the PLAINTEXT is not in the database ─────────────────────────────────
  -- The whole point of the table. A leak of the row must not yield a usable credential.
  SELECT count(*) INTO v_count FROM public.access_token WHERE token_hash = v_token;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL AT-2: the plaintext token is stored in token_hash';
  END IF;
  SELECT token_hash, token_prefix INTO v_hash, v_prefix FROM public.access_token WHERE id = v_id;
  IF v_hash = v_token THEN
    RAISE EXCEPTION 'FAIL AT-2: token_hash equals the plaintext';
  END IF;
  IF v_hash <> encode(digest(v_token, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'FAIL AT-2: token_hash is not the sha256 of the token';
  END IF;

  -- ── AT-3 the stored prefix identifies without revealing ───────────────────────
  -- The dashboard shows `rcp_fcbc40cc0bce…` so a human can tell two tokens apart. It must be
  -- a genuine prefix (or it identifies nothing) and short enough to be unguessable.
  IF v_prefix <> substr(v_token, 1, 16) THEN
    RAISE EXCEPTION 'FAIL AT-3: token_prefix % is not the first 16 chars of the token', v_prefix;
  END IF;

  -- ── AT-4 verify resolves identity, scope and permissions ──────────────────────
  SELECT user_id, permissions, app_ids INTO v_user, v_perms, v_apps
    FROM public.access_token_verify(v_token);
  IF v_user <> '00000000-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'FAIL AT-4: verify resolved the wrong user: %', v_user;
  END IF;
  IF NOT (v_perms @> ARRAY['read','write']) THEN
    RAISE EXCEPTION 'FAIL AT-4: permissions lost in round trip: %', v_perms;
  END IF;
  IF v_apps IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL AT-4: an unscoped token must report app_ids NULL, got %', v_apps;
  END IF;

  -- ── AT-5 verify STAMPS last_used_at ───────────────────────────────────────────
  -- Without this the dashboard's "last used" column is decorative, and a token nobody can
  -- account for looks identical to one in daily use.
  SELECT last_used_at INTO v_used FROM public.access_token WHERE id = v_id;
  IF v_used IS NULL THEN
    RAISE EXCEPTION 'FAIL AT-5: verify did not stamp last_used_at';
  END IF;

  -- ── AT-6 a wrong token resolves to NOTHING, not to a row ──────────────────────
  IF EXISTS (SELECT 1 FROM public.access_token_verify('rcp_' || repeat('x', 40))) THEN
    RAISE EXCEPTION 'FAIL AT-6: an unknown token verified';
  END IF;
  IF EXISTS (SELECT 1 FROM public.access_token_verify('not-even-a-token')) THEN
    RAISE EXCEPTION 'FAIL AT-6: a malformed token verified';
  END IF;

  -- ── AT-7 revocation takes effect immediately ──────────────────────────────────
  PERFORM public.access_token_revoke(v_id, '00000000-0000-0000-0000-0000000000a1');
  IF EXISTS (SELECT 1 FROM public.access_token_verify(v_token)) THEN
    RAISE EXCEPTION 'FAIL AT-7: a revoked token still verifies';
  END IF;

  -- ── AT-8 an EXPIRED token does not verify ─────────────────────────────────────
  SELECT token, id INTO v_token, v_id
    FROM public.access_token_create(
      '00000000-0000-0000-0000-0000000000a1', 'expired', 30, NULL, ARRAY['read']);
  UPDATE public.access_token SET expires_at = now() - interval '1 second' WHERE id = v_id;
  IF EXISTS (SELECT 1 FROM public.access_token_verify(v_token)) THEN
    RAISE EXCEPTION 'FAIL AT-8: an expired token still verifies';
  END IF;

  -- ── AT-9 an app-SCOPED token reports only its apps ────────────────────────────
  SELECT token, id INTO v_token, v_id
    FROM public.access_token_create(
      '00000000-0000-0000-0000-0000000000a1', 'scoped', 30,
      ARRAY['00000000-0000-0000-0000-0000000000b1']::uuid[], ARRAY['read']);
  SELECT app_ids INTO v_apps FROM public.access_token_verify(v_token);
  IF v_apps IS DISTINCT FROM ARRAY['00000000-0000-0000-0000-0000000000b1']::uuid[] THEN
    RAISE EXCEPTION 'FAIL AT-9: scoped token reported app_ids %', v_apps;
  END IF;

  -- ── AT-10 a token cannot be scoped to an app its owner cannot reach ───────────
  -- Otherwise scoping is theatre: name any uuid and the token claims it.
  BEGIN
    PERFORM public.access_token_create(
      '00000000-0000-0000-0000-0000000000a2', 'stolen scope', 30,
      ARRAY['00000000-0000-0000-0000-0000000000b1']::uuid[], ARRAY['read']);
    RAISE EXCEPTION 'FAIL AT-10: a token was scoped to an app its owner cannot reach';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;  -- expected
  END;

  -- ── AT-11 revocation is owner-only ────────────────────────────────────────────
  SELECT token, id INTO v_token, v_id
    FROM public.access_token_create(
      '00000000-0000-0000-0000-0000000000a1', 'mine', 30, NULL, ARRAY['read']);
  BEGIN
    PERFORM public.access_token_revoke(v_id, '00000000-0000-0000-0000-0000000000a2');
    RAISE EXCEPTION 'FAIL AT-11: another user revoked a token that is not theirs';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;  -- expected
  END;

  -- ── AT-12 permissions are a closed set ────────────────────────────────────────
  BEGIN
    PERFORM public.access_token_create(
      '00000000-0000-0000-0000-0000000000a1', 'bad perms', 30, NULL, ARRAY['sudo']);
    RAISE EXCEPTION 'FAIL AT-12: an unknown permission was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;  -- expected
  END;

  RAISE NOTICE 'access_token: 12/12 assertions passed';
END $$;

ROLLBACK;
