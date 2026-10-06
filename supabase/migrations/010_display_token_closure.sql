-- ============================================================
-- 010_display_token_closure.sql — a config can only declare a display the SDK can render
-- ============================================================
-- THE DEFECT
-- `DisplayType.from()` in the SDK (cmp-remote-config/.../model/RemoteConfig.kt) knows four
-- values — dialog, fullscreen, banner, bottom_sheet — and falls back to **DIALOG** for
-- anything else. Two seeded builtins declared `inline`:
--
--     information    {banner,inline}
--     onboarding_tip {inline,banner}
--
-- So a config authored as `inline` would have rendered as a full modal DIALOG on device,
-- with nothing anywhere reporting the mismatch — the server accepted it, the SDK drew the
-- wrong thing, and the operator would see a dialog where they asked for an inline card.
-- The dashboard builder already refuses to offer `inline` for this reason, but a template
-- created through the API could still declare it, so the dashboard is the wrong place for
-- the boundary.
--
-- THE FIX, AND WHY IT IS A CONSTRAINT RATHER THAN A CLEANUP
-- Removing `inline` from the two rows fixes today. A CHECK makes it unfixable-again: the
-- set of renderable displays is a property of the SDK, so the database refuses anything
-- outside it. When the SDK grows an INLINE presentation, this constraint is the one place
-- that has to change, and that is the right amount of friction for "the client cannot draw
-- this yet".
--
-- `none` is in the allowed set deliberately: it is how a value-only template
-- (feature_flag, renders_ui = false) says it draws nothing. It is not an SDK presentation.
--
-- NOT DONE HERE: making DisplayType.from() stop silently defaulting to DIALOG. That is an
-- SDK behaviour change on a published artifact; with this constraint in place the bad input
-- can no longer reach it from our own control plane.
-- ============================================================

-- 1. Clean the two builtins. Both already offered `banner`, so neither loses its only
--    option and no existing config can be orphaned — asserted below.
UPDATE public.template
   SET allowed_displays = array_remove(allowed_displays, 'inline')
 WHERE 'inline' = ANY(allowed_displays);

-- 2. Refuse to proceed if any live config is actually using it. A CHECK added over real
--    `inline` rows would fail the migration anyway; this says WHY instead of surfacing a
--    constraint violation.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM public.config WHERE display = 'inline';
    IF n > 0 THEN
        RAISE EXCEPTION
            'ABORT: % config row(s) use display=''inline''. They must be re-pointed at banner (the closest renderable presentation) before this constraint can be added.', n;
    END IF;
END $$;

-- 3. Every entry of allowed_displays must be renderable by the SDK, or be 'none'.
DO $$ BEGIN
    ALTER TABLE public.template ADD CONSTRAINT template_displays_renderable
        CHECK (allowed_displays <@ ARRAY['dialog','bottom_sheet','banner','fullscreen','none']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. And a config's chosen display must be one the SDK can draw. `none` is permitted here
--    only because config_template_coherence already requires display ∈ allowed_displays,
--    so a 'none' config is necessarily a renders_ui = false template.
DO $$ BEGIN
    ALTER TABLE public.config ADD CONSTRAINT config_display_renderable
        CHECK (display IN ('dialog','bottom_sheet','banner','fullscreen','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
