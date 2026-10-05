-- Rollback of 006_impression. LOCAL EXPERIMENTATION ONLY.
DROP FUNCTION IF EXISTS public.record_event(uuid, uuid, text, text, text);
DROP TABLE IF EXISTS public.impression CASCADE;
