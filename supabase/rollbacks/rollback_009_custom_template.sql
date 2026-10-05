-- Reverse of 009_custom_template.sql.
--
-- ⚠ DESTRUCTIVE AND NOT FULLY REVERSIBLE. Custom templates are rows in public.template
-- with is_builtin = false; this drops the constraints and columns that make them safe but
-- does NOT delete them, because deleting a template that live configs reference would
-- break those configs. After this runs:
--   · the consent record (shared_at / shared_by) is GONE and cannot be reconstructed —
--     export it first if any template was ever community-shared;
--   · custom templates become editable without the immutability trigger;
--   · config_template_coherence reverts to its pre-009 form, which does NOT check that a
--     config's template belongs to the same app. Any cross-app reference created while
--     009 was absent will then be permitted and will couple two tenants.
-- Audit for custom templates before rolling back:
--   SELECT id, app_id, visibility, shared_at FROM public.template WHERE NOT is_builtin;

DROP FUNCTION IF EXISTS public.fork_template(text, uuid);

DROP POLICY IF EXISTS template_delete ON public.template;
DROP POLICY IF EXISTS template_update ON public.template;
DROP POLICY IF EXISTS template_insert ON public.template;
DROP POLICY IF EXISTS template_select ON public.template;
CREATE POLICY template_select ON public.template FOR SELECT TO authenticated
    USING (app_id IS NULL OR public.is_app_member(app_id));
REVOKE INSERT, UPDATE, DELETE ON public.template FROM authenticated;

DROP TRIGGER IF EXISTS trg_template_guard ON public.template;
DROP FUNCTION IF EXISTS public.template_guard();

-- Restore the pre-009 coherence trigger (no tenancy check — see the warning above).
CREATE OR REPLACE FUNCTION public.config_template_coherence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t public.template;
BEGIN
  SELECT * INTO t FROM public.template WHERE id = NEW.template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown template %', NEW.template_id; END IF;
  IF NOT (NEW.display = ANY(t.allowed_displays)) THEN
    RAISE EXCEPTION 'display % not allowed for template % (allowed: %)',
      NEW.display, t.id, t.allowed_displays;
  END IF;
  IF NOT extensions.jsonb_matches_schema(t.payload_schema::json, NEW.payload) THEN
    RAISE EXCEPTION 'payload does not satisfy the schema for template %', t.id;
  END IF;
  IF t.requires_ack AND NEW.is_dismissible THEN
    RAISE EXCEPTION 'template % requires acknowledgement, so is_dismissible must be false', t.id;
  END IF;
  RETURN NEW;
END $$;

DROP INDEX IF EXISTS public.template_community_idx;
ALTER TABLE public.template DROP CONSTRAINT IF EXISTS template_custom_id_shape;
ALTER TABLE public.template DROP CONSTRAINT IF EXISTS template_builtin_not_shareable;
ALTER TABLE public.template DROP CONSTRAINT IF EXISTS template_community_requires_consent;
ALTER TABLE public.template DROP CONSTRAINT IF EXISTS template_visibility_values;
ALTER TABLE public.template
    DROP COLUMN IF EXISTS author_label,
    DROP COLUMN IF EXISTS forked_from,
    DROP COLUMN IF EXISTS shared_by,
    DROP COLUMN IF EXISTS shared_at,
    DROP COLUMN IF EXISTS visibility;
