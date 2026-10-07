-- =============================================================================
-- 011_publish.sql — the publish gate and version history
-- =============================================================================
-- Until now every edit was live on the next fetch. `config.version` incremented but no prior
-- content was retained, so "what was live on Tuesday" had no answer and a bad change could
-- only be fixed by editing forwards under time pressure.
--
-- A configuration change is a deploy. This migration gives it a deploy's gate:
--   * `config` rows become the DRAFT surface — editing one changes nothing a device sees.
--   * `config_version` holds immutable published snapshots.
--   * `/v1/configs` serves the latest snapshot, never the drafts (see v1-configs/index.ts).
--   * rollback publishes a NEW version equal to an old one; it never deletes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.config_version (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id       uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    version      int  NOT NULL,
    -- The whole published config set for the app, as the edge function will serve it. Stored
    -- as one document rather than per-config rows so a snapshot is atomic by construction:
    -- there is no window in which half a publish is visible.
    content      jsonb NOT NULL,
    -- Nullable: a rollback or an automated publish has no interactive user, and losing the
    -- whole audit row because the actor is unknown would be worse than recording NULL.
    published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    -- Set by rollback_to() to the version it restored, so history explains itself.
    rolled_back_from int,
    CONSTRAINT config_version_unique UNIQUE (app_id, version),
    CONSTRAINT config_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS config_version_app_latest
    ON public.config_version (app_id, version DESC);

-- ── immutability ─────────────────────────────────────────────────────────────
-- Enforced by TRIGGER, not by REVOKE. A revoked privilege does not bind the table owner or a
-- superuser, and the `service_role` the edge functions use is exactly the sort of powerful
-- role that would otherwise be able to rewrite history. History that can be rewritten is not
-- an audit trail, so the refusal has to hold for every caller without exception.
CREATE OR REPLACE FUNCTION public.config_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'config_version is append-only: % on version % refused (use rollback_to to undo a publish)',
        TG_OP, COALESCE(OLD.version, -1);
END;
$$;

DROP TRIGGER IF EXISTS trg_config_version_immutable ON public.config_version;
CREATE TRIGGER trg_config_version_immutable
    BEFORE UPDATE OR DELETE ON public.config_version
    FOR EACH ROW EXECUTE FUNCTION public.config_version_immutable();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.config_version ENABLE ROW LEVEL SECURITY;

-- Read-only to members, through the same predicate every other policy resolves through.
-- There is deliberately NO write policy: the only sanctioned way to add a row is publish()
-- or rollback_to(), both SECURITY DEFINER.
DROP POLICY IF EXISTS config_version_select ON public.config_version;
CREATE POLICY config_version_select ON public.config_version FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));

-- ── publish ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish(p_app uuid) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next    int;
    v_content jsonb;
BEGIN
    -- SECURITY DEFINER bypasses RLS, so authorisation is checked explicitly. Without this a
    -- member of ANY app could publish ANY app by passing its id.
    --
    -- service_role is exempt, and that is not an escalation: it already bypasses RLS entirely
    -- and its key lives only in the vault, never in a client. Automation that legitimately
    -- publishes without a user session — CI, a scheduled rollout, a backfill — has no
    -- auth.uid() to check, and the alternative is each caller minting a user JWT, which is a
    -- far wider door than this one.
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.has_app_role(p_app, ARRAY['owner','editor']) THEN
        RAISE EXCEPTION 'not authorised to publish app %', p_app USING ERRCODE = '42501';
    END IF;

    -- Lock the app row so two concurrent publishes cannot both read the same max(version)
    -- and then collide on the unique constraint — or worse, interleave their snapshots.
    PERFORM 1 FROM public.app WHERE id = p_app FOR UPDATE;

    SELECT COALESCE(max(version), 0) + 1 INTO v_next
      FROM public.config_version WHERE app_id = p_app;

    -- Only ENABLED drafts enter a snapshot. A disabled config is not "published but off" —
    -- it is absent, which is what the edge function already means by not serving it.
    --
    -- The template's serving fields are EMBEDDED rather than joined at fetch time, so the
    -- snapshot is self-contained: one read, and what was published is exactly what is served.
    -- It also makes publishing freeze the template contract. That is the point of a deploy
    -- gate — editing a template must not silently change what already-published configs do
    -- on devices; it takes effect at the next publish, like every other change.
    SELECT COALESCE(
             jsonb_agg(
               to_jsonb(c) || jsonb_build_object(
                 'template', jsonb_build_object(
                   'id',              t.id,
                   'version',         t.version,
                   'renders_ui',      t.renders_ui,
                   'requires_ack',    t.requires_ack,
                   'min_sdk_version', t.min_sdk_version
                 )
               )
               ORDER BY c.priority DESC, c.id
             ), '[]'::jsonb)
      INTO v_content
      FROM public.config c
      JOIN public.template t ON t.id = c.template_id
     WHERE c.app_id = p_app AND c.is_enabled;

    INSERT INTO public.config_version (app_id, version, content, published_by)
    VALUES (p_app, v_next, v_content, auth.uid());

    RETURN v_next;
END;
$$;

-- ── rollback ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rollback_to(p_app uuid, p_version int) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next    int;
    v_content jsonb;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.has_app_role(p_app, ARRAY['owner','editor']) THEN
        RAISE EXCEPTION 'not authorised to roll back app %', p_app USING ERRCODE = '42501';
    END IF;

    SELECT content INTO v_content
      FROM public.config_version WHERE app_id = p_app AND version = p_version;
    IF v_content IS NULL THEN
        RAISE EXCEPTION 'version % does not exist for app %', p_version, p_app;
    END IF;

    PERFORM 1 FROM public.app WHERE id = p_app FOR UPDATE;

    SELECT COALESCE(max(version), 0) + 1 INTO v_next
      FROM public.config_version WHERE app_id = p_app;

    -- A NEW version carrying the old content. The version being undone stays in the table:
    -- a "clean" history that erases the mistake cannot answer the question this feature
    -- exists to answer — what was live, and when.
    INSERT INTO public.config_version (app_id, version, content, published_by, rolled_back_from)
    VALUES (p_app, v_next, v_content, auth.uid(), p_version);

    RETURN v_next;
END;
$$;

-- ── routine + table grants ───────────────────────────────────────────────────
-- 007's sweep has already run and cannot cover routines created afterwards. This project has
-- twice shipped a migration whose new functions landed callable by `anon` through the PUBLIC
-- pseudo-role, so every new routine carries its own REVOKE/GRANT pair.
REVOKE ALL    ON TABLE    public.config_version                   FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON TABLE    public.config_version                   TO   authenticated;
GRANT  SELECT, INSERT ON TABLE public.config_version              TO   service_role;

REVOKE EXECUTE ON FUNCTION public.publish(uuid)                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.publish(uuid)                   TO   authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.rollback_to(uuid, int)          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rollback_to(uuid, int)          TO   authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.config_version_immutable()      FROM PUBLIC, anon, authenticated;
