-- =============================================================================
-- 012_parameters.sql — typed parameters + named, reusable conditions
-- =============================================================================
-- Values currently exist only as a `feature_flag` config row with a free-form payload: no
-- type, no default, and no way to say "this value, but different for Android beta users"
-- without authoring a second row and keeping the two in sync by hand.
--
-- Parameters and configs stay SEPARATE objects on purpose. `config` suits bespoke UI overlays
-- (a dialog with a title, a store link, impression caps); `parameter` suits typed values a
-- client reads. One table doing both makes each worse — the overlay grows meaningless type
-- columns and the value grows meaningless display columns.
-- =============================================================================

-- ── parameter ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parameter (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id        uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    key           text NOT NULL,
    type          text NOT NULL CHECK (type IN ('string','boolean','number','json')),
    default_value jsonb NOT NULL,
    description   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT parameter_key_per_app UNIQUE (app_id, key),
    -- Keys reach client code as identifiers, so the shape is constrained here rather than
    -- left to each dashboard form to re-police.
    CONSTRAINT parameter_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

-- The declared type is enforced, not decorative. A boolean parameter holding "yes" would
-- reach a device as a string and the SDK's getBoolean would have to guess — which is exactly
-- the free-form-payload problem this table exists to end.
CREATE OR REPLACE FUNCTION public.jsonb_matches_type(p_value jsonb, p_type text) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'string'  THEN jsonb_typeof(p_value) = 'string'
    WHEN 'boolean' THEN jsonb_typeof(p_value) = 'boolean'
    WHEN 'number'  THEN jsonb_typeof(p_value) = 'number'
    WHEN 'json'    THEN jsonb_typeof(p_value) IN ('object','array')
    ELSE false
  END;
$$;

ALTER TABLE public.parameter DROP CONSTRAINT IF EXISTS parameter_default_matches_type;
ALTER TABLE public.parameter ADD CONSTRAINT parameter_default_matches_type
    CHECK (public.jsonb_matches_type(default_value, type));

-- ── condition ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.condition (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id     uuid NOT NULL REFERENCES public.app(id) ON DELETE CASCADE,
    name       text NOT NULL,
    -- Same vocabulary the config audience filter already speaks: platforms[], screens[],
    -- min_app_version, max_app_version. Phase 05 adds a rollout kind here.
    predicate  jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- App-level default ordering: what the dashboard lists by, and what it seeds a new
    -- attachment's priority from. Resolution order is per-parameter (see parameter_value),
    -- because the same condition can legitimately outrank another for one parameter and not
    -- for the next.
    priority   int NOT NULL DEFAULT 100,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT condition_name_per_app UNIQUE (app_id, name)
);

-- ── parameter_value ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parameter_value (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parameter_id uuid NOT NULL REFERENCES public.parameter(id) ON DELETE CASCADE,
    -- REFERENCES the condition; never copies its predicate. Copying would make "name a
    -- condition once, edit it everywhere" quietly false — each attachment would drift into
    -- its own private rule and nothing would report it.
    condition_id uuid NOT NULL REFERENCES public.condition(id) ON DELETE CASCADE,
    value        jsonb NOT NULL,
    priority     int NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Ties cannot exist. Two overrides at the same priority would make "first match wins"
    -- depend on physical row order — not a decision anyone made, and not stable across a
    -- vacuum.
    CONSTRAINT parameter_value_priority_unique UNIQUE (parameter_id, priority),
    CONSTRAINT parameter_value_once_per_condition UNIQUE (parameter_id, condition_id)
);

CREATE INDEX IF NOT EXISTS parameter_app ON public.parameter (app_id);
CREATE INDEX IF NOT EXISTS condition_app ON public.condition (app_id);
CREATE INDEX IF NOT EXISTS parameter_value_param ON public.parameter_value (parameter_id, priority);

-- ── resolution ───────────────────────────────────────────────────────────────
-- Deliberately SQL, not TypeScript. The edge function already evaluates an audience for
-- configs; a second implementation for parameters would drift from the first, and the two
-- disagreeing about what "Android beta" means is a bug nobody would see until a user did.
-- parameters.ts calls this.
CREATE OR REPLACE FUNCTION public.condition_matches(p_predicate jsonb, p_audience jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    plats    jsonb := p_predicate->'platforms';
    screens  jsonb := p_predicate->'screens';
    min_v    text  := p_predicate->>'min_app_version';
    max_v    text  := p_predicate->>'max_app_version';
    a_plat   text  := p_audience->>'platform';
    a_screen text  := p_audience->>'screen';
    a_ver    text  := p_audience->>'app_version';
BEGIN
    -- An ABSENT key means "no constraint"; an EMPTY array means the same. A missing
    -- predicate key must never be read as "matches nothing", or a condition with one
    -- clause would match no one.
    IF plats IS NOT NULL AND jsonb_array_length(plats) > 0 THEN
        IF a_plat IS NULL OR NOT (plats ? a_plat) THEN RETURN false; END IF;
    END IF;

    IF screens IS NOT NULL AND jsonb_array_length(screens) > 0 THEN
        IF a_screen IS NULL OR NOT (screens ? a_screen) THEN RETURN false; END IF;
    END IF;

    -- Semver compared by padded parts, so 4.10.0 sorts above 4.9.0. A plain text compare
    -- gets that backwards, which silently excludes the newest users from a rollout.
    IF min_v IS NOT NULL THEN
        IF a_ver IS NULL OR public.semver_key(a_ver) < public.semver_key(min_v) THEN RETURN false; END IF;
    END IF;
    IF max_v IS NOT NULL THEN
        IF a_ver IS NULL OR public.semver_key(a_ver) > public.semver_key(max_v) THEN RETURN false; END IF;
    END IF;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.semver_key(p_version text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT string_agg(lpad(part, 6, '0'), '.')
    FROM unnest(string_to_array(split_part(coalesce(p_version,'0'), '-', 1), '.')) AS part;
$$;

CREATE OR REPLACE FUNCTION public.resolve_parameters(p_app uuid, p_audience jsonb) RETURNS jsonb
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_object_agg(p.key, COALESCE(ov.value, p.default_value)), '{}'::jsonb)
    FROM public.parameter p
    LEFT JOIN LATERAL (
      -- First MATCHING override by this parameter's own priority order. LATERAL + LIMIT 1
      -- is what makes "exactly one value per key" structural rather than a hope.
      SELECT pv.value
        FROM public.parameter_value pv
        JOIN public.condition c ON c.id = pv.condition_id
       WHERE pv.parameter_id = p.id
         AND public.condition_matches(c.predicate, p_audience)
       ORDER BY pv.priority
       LIMIT 1
    ) ov ON true
   WHERE p.app_id = p_app;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.parameter       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condition       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parameter_value ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parameter_select ON public.parameter;
CREATE POLICY parameter_select ON public.parameter FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));
DROP POLICY IF EXISTS parameter_write ON public.parameter;
CREATE POLICY parameter_write ON public.parameter FOR ALL TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner','editor']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner','editor']));

DROP POLICY IF EXISTS condition_select ON public.condition;
CREATE POLICY condition_select ON public.condition FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));
DROP POLICY IF EXISTS condition_write ON public.condition;
CREATE POLICY condition_write ON public.condition FOR ALL TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner','editor']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner','editor']));

-- parameter_value has no app_id of its own; it inherits the boundary through its parameter.
-- Resolving membership through the parent is what stops a crafted parameter_id from
-- attaching a value to another tenant's parameter.
DROP POLICY IF EXISTS parameter_value_select ON public.parameter_value;
CREATE POLICY parameter_value_select ON public.parameter_value FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.parameter p
                    WHERE p.id = parameter_id AND public.is_app_member(p.app_id)));
DROP POLICY IF EXISTS parameter_value_write ON public.parameter_value;
CREATE POLICY parameter_value_write ON public.parameter_value FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.parameter p
                    WHERE p.id = parameter_id AND public.has_app_role(p.app_id, ARRAY['owner','editor'])))
    WITH CHECK (EXISTS (SELECT 1 FROM public.parameter p
                    WHERE p.id = parameter_id AND public.has_app_role(p.app_id, ARRAY['owner','editor'])));

-- ── routine + table grants ───────────────────────────────────────────────────
-- 007's sweep has already run and cannot cover routines created afterwards.
REVOKE ALL ON TABLE public.parameter       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.condition       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.parameter_value FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parameter       TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.condition       TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parameter_value TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.resolve_parameters(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_parameters(uuid, jsonb) TO   authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.condition_matches(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.condition_matches(jsonb, jsonb) TO   authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.semver_key(text)                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.semver_key(text)                TO   authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.jsonb_matches_type(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.jsonb_matches_type(jsonb, text) TO   authenticated, service_role;
