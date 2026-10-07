-- Reverses 012_parameters.sql. Drops every parameter, condition and attachment.
DROP FUNCTION IF EXISTS public.resolve_parameters(uuid, jsonb);
DROP TABLE    IF EXISTS public.parameter_value;
DROP TABLE    IF EXISTS public.condition;
DROP TABLE    IF EXISTS public.parameter;
DROP FUNCTION IF EXISTS public.condition_matches(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.semver_key(text);
DROP FUNCTION IF EXISTS public.jsonb_matches_type(jsonb, text);
