-- Rollback of 004_template. LOCAL EXPERIMENTATION ONLY.
-- CASCADE also drops migration 005's config.template_id FK.
DROP TABLE IF EXISTS public.template CASCADE;
