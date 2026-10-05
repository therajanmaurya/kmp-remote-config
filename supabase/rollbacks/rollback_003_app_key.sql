-- Rollback of 003_app_key. LOCAL EXPERIMENTATION ONLY.
DROP TABLE IF EXISTS public.app_key CASCADE;
DROP FUNCTION IF EXISTS public.generate_publishable_key(text);
