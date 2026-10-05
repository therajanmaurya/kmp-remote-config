-- Rollback of 002_app_and_members. LOCAL EXPERIMENTATION ONLY.
-- CASCADE drops every dependent policy and FK from later migrations too.
DROP TABLE IF EXISTS public.app_member CASCADE;
DROP TABLE IF EXISTS public.app CASCADE;
DROP FUNCTION IF EXISTS public.is_app_member(uuid);
DROP FUNCTION IF EXISTS public.has_app_role(uuid, text[]);
DROP FUNCTION IF EXISTS public.app_owner_membership();
DROP FUNCTION IF EXISTS public.touch_updated_at();
