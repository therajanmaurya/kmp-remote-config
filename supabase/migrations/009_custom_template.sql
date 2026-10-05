-- ============================================================
-- 009_custom_template.sql — per-app custom templates + community sharing
-- ============================================================
-- Spec §15 flagged the tier model for this as "not a default — needs an answer before
-- slice 5 is specced", because a user-built layout carries their copy, branding, and
-- sometimes customer-specific wording, so publishing one is a consent and licensing act.
--
-- WHAT THIS MIGRATION DECIDES, AND WHAT IT LEAVES OPEN
-- It makes sharing STRUCTURALLY OPT-IN: a template is born `private` (the INSERT policy
-- permits nothing else), and becoming `community` is a separate deliberate UPDATE whose
-- who-and-when is stamped by a trigger rather than supplied by the client. That is the
-- spec's own recommendation, and it is also the only variant the current schema can
-- express: the "free tier auto-publishes, paid tier chooses" alternative needs a
-- subscription/tier model, and this database has none — no plan table, no entitlement,
-- nothing to read a tier from. Building one is a larger architectural addition that §15
-- defers, so this migration deliberately does not invent it.
--
-- If the tier-gated variant is chosen later, the change is additive and small: the
-- INSERT policy's `visibility = 'private'` clause becomes tier-dependent. Nothing here
-- has to be undone — which is the point of defaulting to the reversible direction. The
-- irreversible direction is publishing someone's work without asking.
--
-- COMMUNITY TEMPLATES ARE A CATALOG TO COPY FROM, NEVER TO REFERENCE.
-- `config.template_id` is an FK, so a config pointing directly at another app's template
-- would couple two tenants: app A deleting its template breaks app B's live configs, and
-- app A un-sharing it silently changes what app B is allowed to do. Adoption therefore
-- COPIES (`fork_template`), and this migration adds the tenancy check to
-- config_template_coherence that makes the direct reference impossible.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sharing columns
-- ------------------------------------------------------------
ALTER TABLE public.template
    ADD COLUMN IF NOT EXISTS visibility   text NOT NULL DEFAULT 'private',
    ADD COLUMN IF NOT EXISTS shared_at    timestamptz,
    -- ON DELETE SET NULL, not CASCADE: deleting the author's account must not delete a
    -- template other apps may have forked, and the consent record losing its subject is
    -- correct — the act still happened.
    ADD COLUMN IF NOT EXISTS shared_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    -- Provenance for a forked copy. ON DELETE SET NULL so deleting the original leaves the
    -- fork working with its lineage simply unknown, rather than blocking the delete.
    ADD COLUMN IF NOT EXISTS forked_from  text REFERENCES public.template(id) ON DELETE SET NULL,
    -- Optional display credit chosen by the author. NOT derived from the account email:
    -- publishing a template must not publish an email address.
    ADD COLUMN IF NOT EXISTS author_label text;

DO $$ BEGIN
    ALTER TABLE public.template ADD CONSTRAINT template_visibility_values
        CHECK (visibility IN ('private', 'community'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Consent is RECORDED, never implied. A 'community' row without a who and a when is a
-- publication nobody can be shown to have agreed to — which is the whole concern §15
-- raises.
DO $$ BEGIN
    ALTER TABLE public.template ADD CONSTRAINT template_community_requires_consent
        CHECK (visibility <> 'community' OR (shared_at IS NOT NULL AND shared_by IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A builtin is already global to every app. Marking one 'community' would assert that
-- some user shared it, which is false and would credit them for our seed data.
DO $$ BEGIN
    ALTER TABLE public.template ADD CONSTRAINT template_builtin_not_shareable
        CHECK (NOT is_builtin OR visibility = 'private');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Custom ids are prefixed so provenance is legible wherever a template id appears —
-- `config.template_id`, an SDK log line, a support thread. Without this a custom template
-- could be called `update_available_v2` and read as one of ours, and the operator would
-- reasonably expect our min_sdk_version guarantees to apply to it.
DO $$ BEGIN
    ALTER TABLE public.template ADD CONSTRAINT template_custom_id_shape
        CHECK (is_builtin OR id ~ '^c_[a-z0-9][a-z0-9_-]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The community catalog is browsed by every signed-in operator, so it gets its own index
-- rather than scanning every app's private templates.
CREATE INDEX IF NOT EXISTS template_community_idx
    ON public.template (visibility, created_at DESC)
    WHERE visibility = 'community';

-- ------------------------------------------------------------
-- 2. Immutability + consent stamping
-- ------------------------------------------------------------
-- The client supplies neither the sharer nor the timestamp. If it did, a dashboard bug —
-- or a crafted request — could attribute a publication to another user, and the consent
-- record would be worth nothing.
CREATE OR REPLACE FUNCTION public.template_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Identity and ownership are fixed at creation. Allowing app_id to move would let
        -- an editor relocate a template into an app they do not belong to; allowing
        -- is_builtin to flip would let a user mint something that claims to be ours.
        IF NEW.id <> OLD.id THEN
            RAISE EXCEPTION 'template id is immutable';
        END IF;
        IF NEW.is_builtin <> OLD.is_builtin THEN
            RAISE EXCEPTION 'is_builtin is immutable';
        END IF;
        IF COALESCE(NEW.app_id::text, '') <> COALESCE(OLD.app_id::text, '') THEN
            RAISE EXCEPTION 'template app_id is immutable';
        END IF;

        -- private → community: stamp the consent server-side.
        IF NEW.visibility = 'community' AND OLD.visibility <> 'community' THEN
            NEW.shared_at := now();
            NEW.shared_by := auth.uid();
        -- community → private: withdraw it. The row keeps working for anyone who already
        -- forked a COPY, which is why forking copies rather than references.
        ELSIF NEW.visibility = 'private' AND OLD.visibility <> 'private' THEN
            NEW.shared_at := NULL;
            NEW.shared_by := NULL;
        ELSIF NEW.visibility = 'community' THEN
            -- Already shared and staying shared: the original consent stands and cannot be
            -- rewritten to a different author or date.
            NEW.shared_at := OLD.shared_at;
            NEW.shared_by := OLD.shared_by;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Belt and braces behind the INSERT policy: born private, with no forged consent.
        IF NEW.visibility <> 'private' THEN
            RAISE EXCEPTION 'a template is created private; share it in a separate, deliberate step';
        END IF;
        NEW.shared_at := NULL;
        NEW.shared_by := NULL;
    END IF;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_template_guard ON public.template;
CREATE TRIGGER trg_template_guard BEFORE INSERT OR UPDATE ON public.template
    FOR EACH ROW EXECUTE FUNCTION public.template_guard();

-- ------------------------------------------------------------
-- 3. RLS — read the community catalog; write only your own app's custom templates
-- ------------------------------------------------------------
GRANT INSERT, UPDATE, DELETE ON public.template TO authenticated;

DROP POLICY IF EXISTS template_select ON public.template;
CREATE POLICY template_select ON public.template FOR SELECT TO authenticated
    USING (
        app_id IS NULL                      -- the 15 builtins
        OR public.is_app_member(app_id)     -- your own app's templates, private or shared
        OR visibility = 'community'         -- the catalog
    );

-- Creation: your own app, never a builtin, always private.
CREATE POLICY template_insert ON public.template FOR INSERT TO authenticated
    WITH CHECK (
        NOT is_builtin
        AND app_id IS NOT NULL
        AND public.has_app_role(app_id, ARRAY['owner', 'editor'])
        AND visibility = 'private'
    );

-- Editing and sharing. USING gates which rows you may touch; WITH CHECK gates the result,
-- so an editor cannot rewrite a row into one they would not have been allowed to touch.
CREATE POLICY template_update ON public.template FOR UPDATE TO authenticated
    USING (NOT is_builtin AND app_id IS NOT NULL AND public.has_app_role(app_id, ARRAY['owner', 'editor']))
    WITH CHECK (NOT is_builtin AND app_id IS NOT NULL AND public.has_app_role(app_id, ARRAY['owner', 'editor']));

-- Deletion is owner-only: an editor sharing a template is recoverable, an editor deleting
-- one that other apps have forked FROM is not.
CREATE POLICY template_delete ON public.template FOR DELETE TO authenticated
    USING (NOT is_builtin AND app_id IS NOT NULL AND public.has_app_role(app_id, ARRAY['owner']));

-- ------------------------------------------------------------
-- 4. config.template_id must be a template THIS app may use
-- ------------------------------------------------------------
-- Pre-existing hole, harmless until now: the trigger resolved the template by id with no
-- tenancy check, which was fine while every template was global. With per-app templates a
-- config could reference another tenant's private row — coupling the two apps (app A's
-- delete breaks app B) and leaking app A's schema through validation errors.
CREATE OR REPLACE FUNCTION public.config_template_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t public.template;
BEGIN
  SELECT * INTO t FROM public.template WHERE id = NEW.template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown template %', NEW.template_id;
  END IF;
  -- A config may use a builtin or its OWN app's template. A community template is adopted
  -- by COPYING it (public.fork_template), never by pointing at the original.
  IF t.app_id IS NOT NULL AND t.app_id <> NEW.app_id THEN
    RAISE EXCEPTION 'template % belongs to another app; fork it into this app first', t.id;
  END IF;
  IF NOT (NEW.display = ANY(t.allowed_displays)) THEN
    RAISE EXCEPTION 'display % not allowed for template % (allowed: %)',
      NEW.display, t.id, t.allowed_displays;
  END IF;
  -- The server owns renderability (§4): a payload that does not satisfy its template's
  -- schema can never render, so it must not be storable. The dashboard form is a
  -- convenience, not the validator. The schema argument is `json`, not `jsonb` (checked
  -- against pg_get_function_arguments), so payload_schema needs the cast.
  IF NOT extensions.jsonb_matches_schema(t.payload_schema::json, NEW.payload) THEN
    RAISE EXCEPTION 'payload does not satisfy the schema for template %', t.id;
  END IF;
  -- A terms change a user can swipe away has not been accepted.
  IF t.requires_ack AND NEW.is_dismissible THEN
    RAISE EXCEPTION 'template % requires acknowledgement, so is_dismissible must be false', t.id;
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 5. fork_template — adopt a community template by copying it
-- ------------------------------------------------------------
-- SECURITY DEFINER because the caller must be able to read a community row and write into
-- their own app in one atomic step; the authorization it enforces itself is the pair of
-- checks below, which are stricter than what the policies alone would allow.
CREATE OR REPLACE FUNCTION public.fork_template(p_source text, p_target_app uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    s      public.template;
    new_id text;
BEGIN
    -- The caller must be able to WRITE the destination. Without this check a DEFINER
    -- function would let any signed-in user plant templates in any app.
    IF NOT public.has_app_role(p_target_app, ARRAY['owner', 'editor']) THEN
        RAISE EXCEPTION 'not permitted to add templates to that app';
    END IF;

    SELECT * INTO s FROM public.template WHERE id = p_source;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown template %', p_source;
    END IF;

    -- Forkable: a builtin, something shared with the community, or a template the caller
    -- already has access to in their own app. A private template belonging to a DIFFERENT
    -- app is not forkable, and the error must not reveal whether it exists.
    IF NOT (s.is_builtin OR s.visibility = 'community' OR public.is_app_member(s.app_id)) THEN
        RAISE EXCEPTION 'unknown template %', p_source;
    END IF;

    new_id := 'c_' || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO public.template (
        id, version, display_name, description, payload_schema, allowed_displays,
        min_sdk_version, requires_ack, renders_ui, is_builtin, app_id,
        visibility, forked_from, author_label
    ) VALUES (
        new_id, 1, s.display_name, s.description, s.payload_schema, s.allowed_displays,
        s.min_sdk_version, s.requires_ack, s.renders_ui,
        false,            -- a fork is never a builtin, even when forked FROM one
        p_target_app,
        'private',        -- born private: adopting someone's template is not republishing it
        s.id,
        NULL              -- the fork is not credited to the original author
    );

    RETURN new_id;
END $$;

-- ------------------------------------------------------------
-- 6. Routine grants — the pair 007's sweep warns a later migration must carry
-- ------------------------------------------------------------
-- Measured on migration 008: a new function lands with `=X/postgres` in proacl — an empty
-- grantee, i.e. the PUBLIC pseudo-role — so anon and authenticated hold EXECUTE by
-- inheritance with no grant naming either, and harness_test.sql fails.
REVOKE EXECUTE ON FUNCTION public.template_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fork_template(text, uuid) FROM PUBLIC, anon, authenticated;

-- fork_template is a dashboard action, so the operator role needs it. template_guard is
-- invoked by the trigger engine and stays revoked, like the other trigger functions.
GRANT EXECUTE ON FUNCTION public.fork_template(text, uuid) TO authenticated;
