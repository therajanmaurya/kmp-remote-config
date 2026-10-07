-- =============================================================================
-- 014_rollout.sql — staged percentage rollout + cohorts
-- =============================================================================
-- Ship a config to a stable slice of the install base. The BUCKETING lives in the edge
-- function (`rollout.ts`) because the device id arrives in a request header; this migration
-- owns the column and the bounds a dashboard form cannot be trusted to enforce, since an API
-- caller bypasses the form.
--
-- `publish()` needs no change: it snapshots with `to_jsonb(c)`, so these columns travel into
-- every new version automatically — and a rollout change therefore goes through the Phase 02
-- publish gate like any other edit, rather than being instantly live.
-- =============================================================================

ALTER TABLE public.config
    -- Defaults to 100 — fully rolled out. Defaulting to 0 would make every newly authored
    -- config invisible to everyone, which reads as "the product is broken" rather than as a
    -- deliberate staging default.
    ADD COLUMN IF NOT EXISTS rollout_percentage int NOT NULL DEFAULT 100,
    -- Free-form operator label. NULL means no cohort restriction.
    ADD COLUMN IF NOT EXISTS cohort text;

ALTER TABLE public.config DROP CONSTRAINT IF EXISTS config_rollout_percentage_range;
ALTER TABLE public.config ADD CONSTRAINT config_rollout_percentage_range
    -- 0 is legal and distinct from disabling: "published, reaching nobody yet" is the state a
    -- staged rollout starts from. 101 is a typo and -1 a sign error; either reaching a
    -- snapshot would leave the served audience undefined.
    CHECK (rollout_percentage BETWEEN 0 AND 100);

COMMENT ON COLUMN public.config.rollout_percentage IS
  'Percentage of devices that receive this config. Bucketing is hash(config_id:device_id) % 100 '
  'compared against this value — the percentage is NEVER part of the hash input, which is what '
  'makes raising it purely additive.';
