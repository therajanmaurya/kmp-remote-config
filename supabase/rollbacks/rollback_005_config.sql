-- Rollback of 005_config. LOCAL EXPERIMENTATION ONLY.
-- CASCADE also drops migration 006's impression.config_id FK.
DROP TABLE IF EXISTS public.config CASCADE;
DROP FUNCTION IF EXISTS public.config_template_coherence();
