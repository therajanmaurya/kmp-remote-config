-- Reverses 014_rollout.sql. Every config reverts to reaching 100% of devices.
ALTER TABLE public.config DROP CONSTRAINT IF EXISTS config_rollout_percentage_range;
ALTER TABLE public.config DROP COLUMN IF EXISTS rollout_percentage;
ALTER TABLE public.config DROP COLUMN IF EXISTS cohort;
