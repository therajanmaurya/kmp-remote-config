-- ============================================================
-- Inviting people to an app.
--
-- Access is per APP — `app_member(app_id, user_id, role)` — and the only way to create a row in
-- it was to be the person who onboarded the app. There was no way to bring anyone else in, which
-- made the Members page a list of one.
--
-- SHAPE: invite by EMAIL, claim on SIGN-IN.
-- An invitation names an email, not a user, because the invitee usually has no account yet. When
-- someone signs in, any pending invitation matching their verified address becomes a membership.
-- No invite link, no token in a URL: sign-in is through Google OAuth, so the address is already
-- proven by the identity provider. A link-with-token would add a second, weaker credential that
-- can be forwarded, logged by a mail scanner, or replayed — to establish something OAuth has
-- already established.
--
-- `profile` comes with it rather than separately. The Members page currently shows everyone but
-- you as a truncated uuid, with the comment "other members show by id until an invite flow
-- records a display name" — an invite feature that still rendered colleagues as `a3f9c1b2…`
-- would be the feature without the point of it. `auth.users` is not readable under RLS and
-- exposing it would be an email-enumeration surface, so the address is mirrored into a table
-- with a membership-scoped policy.
-- ============================================================

-- ── profile ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile TO authenticated;

-- Readable only for people you already share an app with. Not "readable by any authenticated
-- user": that would turn the table into a directory of every address in the system, which is
-- exactly the enumeration surface avoided by not exposing auth.users.
DROP POLICY IF EXISTS profile_select ON public.profile;
CREATE POLICY profile_select ON public.profile FOR SELECT TO authenticated
    USING (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1
          FROM public.app_member mine
          JOIN public.app_member theirs ON theirs.app_id = mine.app_id
         WHERE mine.user_id = auth.uid() AND theirs.user_id = public.profile.user_id
      )
    );

-- No INSERT/UPDATE policy on purpose: the only writer is the definer function below, so a
-- client cannot claim an address it does not own.
CREATE OR REPLACE FUNCTION public.profile_sync() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  -- From the JWT, never from an argument. A caller-supplied address would let anyone write
  -- somebody else's email next to their own user id.
  v_email := nullif(trim(lower(auth.jwt() ->> 'email')), '');
  IF v_email IS NULL THEN RETURN; END IF;

  INSERT INTO public.profile (user_id, email, updated_at)
  VALUES (auth.uid(), v_email, now())
  ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION public.profile_sync() TO authenticated;

-- ── app_invitation ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_invitation (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id      uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    -- Stored lowercased and trimmed; matching is exact against the JWT's address, also
    -- lowercased. Case-insensitive matching has to be decided once, in one place, or
    -- "Alice@x.com" silently never matches the invitation sent to "alice@x.com".
    email       text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
    role        text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
    invited_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- An invitation that never expires is a standing grant to whoever controls that mailbox,
    -- years later.
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
    accepted_at timestamptz,
    accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    revoked_at  timestamptz
);

-- One PENDING invitation per (app, email). Re-inviting someone who has not answered should
-- update the existing row, not stack duplicates that each grant access on the same sign-in.
-- Partial, so the same person can legitimately be re-invited after leaving.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_invitation_pending
    ON public.app_invitation (app_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_invitation_email ON public.app_invitation (email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.app_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_invitation FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.app_invitation TO authenticated;

-- Owners manage invitations for their own apps. Editors deliberately cannot: being able to
-- edit configs is not the same authority as being able to grant someone else that ability.
DROP POLICY IF EXISTS app_invitation_select ON public.app_invitation;
CREATE POLICY app_invitation_select ON public.app_invitation FOR SELECT TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner']));

DROP POLICY IF EXISTS app_invitation_write ON public.app_invitation;
CREATE POLICY app_invitation_write ON public.app_invitation FOR INSERT TO authenticated
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner']) AND invited_by = auth.uid());

-- UPDATE covers revoking. Acceptance is NOT done here — it is done by the definer function
-- below, because the invitee is by definition not yet a member and so matches no policy.
DROP POLICY IF EXISTS app_invitation_update ON public.app_invitation;
CREATE POLICY app_invitation_update ON public.app_invitation FOR UPDATE TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner']));

-- ── accepting ───────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the whole point is to act for someone who has no membership yet:
-- under RLS the invitee can see neither the invitation nor the app, so they cannot possibly
-- insert their own `app_member` row.
--
-- It takes no arguments. Identity comes from the JWT alone, so there is nothing a caller can
-- pass to claim an invitation addressed to someone else.
CREATE OR REPLACE FUNCTION public.invitation_accept_pending()
RETURNS TABLE (app_id uuid, role text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text; v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN; END IF;
  v_email := nullif(trim(lower(auth.jwt() ->> 'email')), '');
  IF v_email IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT i.id, i.app_id, i.role
      FROM public.app_invitation i
     WHERE i.email = v_email
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
    -- Two sign-ins racing would otherwise both pass the "not accepted" test and both insert.
    FOR UPDATE SKIP LOCKED
  ), granted AS (
    INSERT INTO public.app_member (app_id, user_id, role)
    SELECT c.app_id, v_uid, c.role FROM claimable c
    -- Already a member: the invitation is still consumed below, but an existing role is NOT
    -- overwritten. Silently demoting an owner to editor because someone re-invited them is a
    -- worse outcome than ignoring the role on an invitation they did not need.
    ON CONFLICT (app_id, user_id) DO NOTHING
    RETURNING public.app_member.app_id, public.app_member.role
  ), consumed AS (
    UPDATE public.app_invitation i
       SET accepted_at = now(), accepted_by = v_uid
      FROM claimable c WHERE i.id = c.id
    RETURNING i.app_id, i.role
  )
  SELECT c.app_id, c.role FROM consumed c;
END $$;
GRANT EXECUTE ON FUNCTION public.invitation_accept_pending() TO authenticated;
