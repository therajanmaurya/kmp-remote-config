-- =============================================================================
-- 013_app_settings.sql — server-delivered SDK settings + the kill switch
-- =============================================================================
-- The fetch interval is currently a compile-time constant in the consumer app. A server under
-- load cannot ask clients to back off, and a misbehaving integration cannot be disabled
-- without shipping an app release through two review queues.
--
-- BOUNDS LIVE HERE, not in the dashboard form. A `fetch_interval_seconds = 1` row would reach
-- every device and then could not be withdrawn faster than the interval it just set — an
-- operator would have armed a self-inflicted DDoS with no way back. An API caller bypasses
-- the form; it cannot bypass a CHECK.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
    -- One row per app, enforced by making app_id the PRIMARY KEY. Two rows would make
    -- "which settings are live" a coin flip decided by row order.
    app_id                 uuid PRIMARY KEY REFERENCES public.app(id) ON DELETE CASCADE,

    -- The kill switch. Defaults TRUE: a newly created app must not be born switched off.
    enabled                boolean NOT NULL DEFAULT true,

    -- 60s floor / 24h ceiling. The ceiling matters as much as the floor — a 90-day interval
    -- is indistinguishable from the SDK being off, except that it looks like a working
    -- configuration to whoever set it.
    fetch_interval_seconds int NOT NULL DEFAULT 3600
                               CHECK (fetch_interval_seconds BETWEEN 60 AND 86400),

    -- How long a client may serve its cache before the values are considered stale. Allowed
    -- to exceed the fetch interval: that is the offline grace period, deliberately.
    cache_ttl_seconds      int NOT NULL DEFAULT 86400
                               CHECK (cache_ttl_seconds BETWEEN 60 AND 604800),

    max_retries            int NOT NULL DEFAULT 3  CHECK (max_retries BETWEEN 0 AND 10),
    backoff_base_seconds   int NOT NULL DEFAULT 2  CHECK (backoff_base_seconds BETWEEN 1 AND 300),

    updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO authenticated
    USING (public.is_app_member(app_id));
DROP POLICY IF EXISTS app_settings_write ON public.app_settings;
CREATE POLICY app_settings_write ON public.app_settings FOR ALL TO authenticated
    USING (public.has_app_role(app_id, ARRAY['owner','editor']))
    WITH CHECK (public.has_app_role(app_id, ARRAY['owner','editor']));

-- Every app gets a settings row on creation, so the edge function never has to decide whether
-- "no row" means defaults or means disabled. An absent row is the kind of ambiguity that ends
-- with a kill switch read as "off" for an app nobody touched.
CREATE OR REPLACE FUNCTION public.app_settings_default() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.app_settings (app_id) VALUES (NEW.id)
    ON CONFLICT (app_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_default ON public.app;
CREATE TRIGGER trg_app_settings_default AFTER INSERT ON public.app
    FOR EACH ROW EXECUTE FUNCTION public.app_settings_default();

-- Backfill the apps that already exist, for the same reason.
INSERT INTO public.app_settings (app_id)
SELECT id FROM public.app ON CONFLICT (app_id) DO NOTHING;

-- ── grants ───────────────────────────────────────────────────────────────────
-- 007's sweep has already run and cannot cover routines created afterwards.
REVOKE ALL ON TABLE public.app_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_settings TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.app_settings_default() FROM PUBLIC, anon, authenticated;
