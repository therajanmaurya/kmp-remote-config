-- ============================================================
-- config — a deliverable: a template plus its payload, targeting and schedule.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.config (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id          uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    template_id     text NOT NULL REFERENCES public.template(id),
    payload         jsonb NOT NULL,
    display         text NOT NULL,
    -- EMPTY = every screen. Keeps an app-wide announcement a zero-effort author action
    -- while making per-screen targeting a first-class filter.
    screens         text[] NOT NULL DEFAULT '{}',
    platforms       text[] NOT NULL DEFAULT '{}',
    min_app_version text,
    max_app_version text,
    -- Reserved: one payload per config for now. Per-locale variants are slice 4.
    locale          text,
    priority        int NOT NULL DEFAULT 0,
    -- FALSE by default — a deliberate inversion of the legacy table's DEFAULT TRUE.
    -- Dashboard authoring means a row exists while it is still being written, and a
    -- default-on row is live the moment it is inserted.
    is_enabled      boolean NOT NULL DEFAULT false,
    starts_at       timestamptz,
    ends_at         timestamptz,
    max_impressions int NOT NULL DEFAULT 1  CHECK (max_impressions >= 0),
    cooldown_hours  int NOT NULL DEFAULT 24 CHECK (cooldown_hours  >= 0),
    is_dismissible  boolean NOT NULL DEFAULT true,
    -- bump to re-show within an existing impression cap window
    version         int NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT config_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_config_audience
    ON public.config (app_id, is_enabled, priority DESC);

DROP TRIGGER IF EXISTS trg_config_touch ON public.config;
CREATE TRIGGER trg_config_touch BEFORE UPDATE ON public.config
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Template coherence is enforced by a TRIGGER, not a CHECK constraint: a CHECK cannot
-- contain a subquery, and both rules below must consult the template row. Writing it as
-- a constraint is the obvious first attempt and Postgres rejects it.
CREATE OR REPLACE FUNCTION public.config_template_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t public.template;
BEGIN
  SELECT * INTO t FROM public.template WHERE id = NEW.template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown template %', NEW.template_id;
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

DROP TRIGGER IF EXISTS trg_config_template_coherence ON public.config;
CREATE TRIGGER trg_config_template_coherence BEFORE INSERT OR UPDATE ON public.config
    FOR EACH ROW EXECUTE FUNCTION public.config_template_coherence();

ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config TO authenticated;

CREATE POLICY config_select ON public.config FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));
CREATE POLICY config_write ON public.config FOR ALL TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner','editor']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner','editor']));
