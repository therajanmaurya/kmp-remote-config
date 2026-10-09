-- ============================================================
-- 018 — close the default-PUBLIC EXECUTE grant on the access-token routines.
--
-- Postgres grants EXECUTE on a new function to PUBLIC automatically. Migrations 016 and 017
-- granted to `authenticated` explicitly and said nothing about PUBLIC, so `anon` picked up
-- EXECUTE on three routines by default — which `harness_test.sql` caught:
--
--     FAIL: anon can EXECUTE 3 routine(s) in public
--
-- That is the assertion earning its keep. It is written as an end-state claim about the whole
-- schema precisely so a routine nobody thought about still trips it.
--
-- HOW BAD WAS IT
-- Not immediately exploitable: migration 001 revoked anon's USAGE on schema `public`, so anon
-- could not name the function to call it. But the exposure was one config change away from
-- severe — `access_token_create` is SECURITY DEFINER and takes the owner's id as a PARAMETER,
-- so a caller who could reach it could mint a live access token for ANY user and act as them.
-- A defence that holds only because of a second, unrelated defence is not one worth keeping.
--
-- So this migration does two things: removes the accidental grant, and removes the reason it
-- would have mattered.
-- ============================================================

-- ── 1. No implicit PUBLIC grant on anything these migrations added ───────────────
REVOKE EXECUTE ON FUNCTION public.access_token_create(uuid, text, int, uuid[], text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.access_token_revoke(uuid, uuid)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.access_token_verify(text)                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.access_token_apps(uuid, uuid, boolean)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_access_token()                               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rconfig_api(text, text, jsonb)                        FROM PUBLIC, anon, authenticated;

-- `authenticated` keeps exactly what the dashboard needs: mint and revoke its OWN tokens.
GRANT EXECUTE ON FUNCTION public.access_token_create(uuid, text, int, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.access_token_revoke(uuid, uuid)                       TO authenticated;

-- ── 2. Remove the reason it would have mattered ──────────────────────────────────
-- `access_token_create` took the owner's id on trust. For the dashboard that is fine — it
-- passes auth.uid() — but "fine because every caller behaves" is not a boundary. A SECURITY
-- DEFINER function that mints a credential for whichever user it is handed must verify that
-- the caller IS that user.
--
-- auth.uid() is NULL for the service role, which is how `v1-admin` and operational scripts run;
-- those are trusted server-side callers and keep the ability to mint for a named user. Any
-- authenticated caller may only ever mint for themselves.
CREATE OR REPLACE FUNCTION public.access_token_create(
    p_user_id         uuid,
    p_name            text,
    p_expires_in_days int     DEFAULT 30,
    p_app_ids         uuid[]  DEFAULT NULL,
    p_permissions     text[]  DEFAULT ARRAY['read']::text[]
) RETURNS TABLE (id uuid, token text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_token  text;
  v_id     uuid;
  v_app    uuid;
  v_bad    text;
  v_caller uuid := auth.uid();
BEGIN
  -- The check this function was missing. A logged-in user minting a token for someone else is
  -- account takeover, not a feature.
  IF v_caller IS NOT NULL AND v_caller <> p_user_id THEN
    RAISE EXCEPTION 'you can only create access tokens for yourself' USING ERRCODE = '42501';
  END IF;

  SELECT x INTO v_bad FROM unnest(p_permissions) AS x
   WHERE x NOT IN ('read','write','publish') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'unknown permission: %. Valid: read, write, publish', v_bad
      USING ERRCODE = '22023';
  END IF;

  IF p_expires_in_days IS NOT NULL AND p_expires_in_days <= 0 THEN
    RAISE EXCEPTION 'expires_in_days must be positive, got %', p_expires_in_days
      USING ERRCODE = '22023';
  END IF;

  -- Scoping is only meaningful if it cannot be claimed over apps the owner has no business
  -- reaching. Without this a user could name any uuid and the token would assert it.
  IF p_app_ids IS NOT NULL THEN
    FOREACH v_app IN ARRAY p_app_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.app_member m WHERE m.app_id = v_app AND m.user_id = p_user_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.app a WHERE a.id = v_app AND a.owner_id = p_user_id
      ) THEN
        RAISE EXCEPTION 'cannot scope a token to app % — its owner is not a member', v_app
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  v_token := public.generate_access_token();

  INSERT INTO public.access_token (user_id, name, token_hash, token_prefix, scoped, permissions, expires_at)
  VALUES (
    p_user_id,
    trim(p_name),
    encode(digest(v_token, 'sha256'), 'hex'),
    substr(v_token, 1, 16),
    p_app_ids IS NOT NULL,
    p_permissions,
    CASE WHEN p_expires_in_days IS NULL THEN NULL
         ELSE now() + make_interval(days => p_expires_in_days) END
  )
  RETURNING access_token.id INTO v_id;

  IF p_app_ids IS NOT NULL THEN
    INSERT INTO public.access_token_app (token_id, app_id)
    SELECT v_id, unnest(p_app_ids);
  END IF;

  RETURN QUERY SELECT v_id, v_token;
END $$;

-- CREATE OR REPLACE re-grants PUBLIC by default, so the revocation has to follow the redefinition.
REVOKE EXECUTE ON FUNCTION public.access_token_create(uuid, text, int, uuid[], text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.access_token_create(uuid, text, int, uuid[], text[]) TO authenticated;

-- ── 3. Default-deny for every routine added to `public` from here on ─────────────
-- The accident this migration cleans up was a DEFAULT. Fixing the three affected routines
-- without changing the default would leave the next migration to make the same mistake.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 4. Revoke what `authenticated` never needed ──────────────────────────────────
-- Surfaced once the anon failure above stopped short-circuiting the harness's SECOND assertion:
-- its allowlist for `authenticated` predates migrations 011-015, so this check had been red and
-- unseen since those landed.
--
-- Each revocation below is safe for a specific, checked reason — the caller is SECURITY DEFINER,
-- so the helper runs as the function's OWNER and the invoking role needs no privilege of its own:
--
--   condition_matches · semver_key · jsonb_matches_type  internals of resolve_parameters (DEFINER)
--   generate_access_token                                internal of access_token_create (DEFINER)
--   consume_rate_limit · record_event                    called by edge functions (service role)
REVOKE EXECUTE ON FUNCTION public.condition_matches(jsonb, jsonb)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.jsonb_matches_type(jsonb, text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_access_token()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.semver_key(text)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_event(uuid, uuid, text, text, text)            FROM PUBLIC, anon, authenticated;
