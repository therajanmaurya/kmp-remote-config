-- Reverses 013_app_settings.sql. Every app reverts to the SDK's compiled-in defaults.
DROP TRIGGER  IF EXISTS trg_app_settings_default ON public.app;
DROP TABLE    IF EXISTS public.app_settings;
DROP FUNCTION IF EXISTS public.app_settings_default();
