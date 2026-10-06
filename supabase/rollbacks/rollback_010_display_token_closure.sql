-- Reverse of 010_display_token_closure.sql.
--
-- Dropping these constraints re-opens the silent mis-render: a config may again declare a
-- display the SDK cannot draw, and DisplayType.from() will render it as a DIALOG with
-- nothing reporting the mismatch. It does NOT restore `inline` to the two builtins
-- (information, onboarding_tip) — re-add it deliberately if the SDK has since grown an
-- INLINE presentation:
--   UPDATE public.template SET allowed_displays = allowed_displays || 'inline'
--    WHERE id IN ('information','onboarding_tip');
ALTER TABLE public.config   DROP CONSTRAINT IF EXISTS config_display_renderable;
ALTER TABLE public.template DROP CONSTRAINT IF EXISTS template_displays_renderable;
