-- ============================================================
-- app + app_member, and the membership predicate every later policy resolves through.
--
-- Policies resolve through app_member, NEVER through app.owner_id. That is what makes
-- adding teams later a UI change rather than a migration that rewrites every policy.
-- app_member therefore ships now, with no dashboard surface.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slug         text NOT NULL,
    display_name text NOT NULL,
    platforms    text[] NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- Per OWNER, not global: two operators may each have an app called "app-a".
    CONSTRAINT app_slug_per_owner UNIQUE (owner_id, slug),
    CONSTRAINT app_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$')
);

CREATE TABLE IF NOT EXISTS public.app_member (
    app_id  uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role    text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','editor','viewer')),
    PRIMARY KEY (app_id, user_id)
);

-- Shared updated_at trigger fn — migration 005's `config` reuses it.
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_app_touch ON public.app;
CREATE TRIGGER trg_app_touch BEFORE UPDATE ON public.app
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Creating an app makes the creator its owner-member. Without this, every policy below
-- would deny the creator access to the app they just created.
CREATE OR REPLACE FUNCTION public.app_owner_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.app_member (app_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (app_id, user_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_app_owner_membership ON public.app;
CREATE TRIGGER trg_app_owner_membership AFTER INSERT ON public.app
    FOR EACH ROW EXECUTE FUNCTION public.app_owner_membership();

-- SECURITY DEFINER is REQUIRED, not a shortcut: the policy on app_member below queries
-- app_member, which would recurse through its own policy. Safe because the function takes
-- only an app id and reads only membership. search_path is pinned so a caller cannot
-- shadow `app_member` with a temp table and lie about membership.
CREATE OR REPLACE FUNCTION public.is_app_member(p_app uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_member
                 WHERE app_id = p_app AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_app_role(p_app uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_member
                 WHERE app_id = p_app AND user_id = auth.uid() AND role = ANY(p_roles));
$$;

-- Migration 001 revoked EXECUTE on routines from PUBLIC and set a default-privileges
-- revoke, so these two must be granted explicitly to the role that needs them.
GRANT EXECUTE ON FUNCTION public.is_app_member(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_role(uuid, text[]) TO authenticated;

ALTER TABLE public.app        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_member FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_member TO authenticated;

CREATE POLICY app_select ON public.app FOR SELECT TO authenticated
    USING (public.is_app_member(id));
CREATE POLICY app_insert ON public.app FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid());
CREATE POLICY app_update ON public.app FOR UPDATE TO authenticated
    USING (public.has_app_role(id, ARRAY['owner']))
    WITH CHECK (public.has_app_role(id, ARRAY['owner']));
CREATE POLICY app_delete ON public.app FOR DELETE TO authenticated
    USING (public.has_app_role(id, ARRAY['owner']));

CREATE POLICY app_member_select ON public.app_member FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));
CREATE POLICY app_member_write ON public.app_member FOR ALL TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner']));
