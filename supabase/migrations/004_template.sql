-- ============================================================
-- template — the config-type registry.
--
-- Templates are DATA, not code paths. payload_schema drives BOTH the dashboard's
-- generated form AND server-side write validation, so adding a config type is a
-- migration rather than a dashboard release.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.template (
    id               text PRIMARY KEY,
    version          int  NOT NULL DEFAULT 1,
    display_name     text NOT NULL,
    description      text,
    payload_schema   jsonb NOT NULL,
    allowed_displays text[] NOT NULL,
    -- The server refuses to SEND a template the calling SDK cannot render. This is what
    -- structurally removes the blank-surface class that UiNode.Unknown only softens: the
    -- client never has to degrade, because it never receives the shape.
    min_sdk_version  text NOT NULL DEFAULT '4.0.0',
    requires_ack     boolean NOT NULL DEFAULT false,
    renders_ui       boolean NOT NULL DEFAULT true,
    is_builtin       boolean NOT NULL DEFAULT true,
    -- null = global built-in; set = app-private (slice 4's user templates)
    app_id           uuid REFERENCES public.app(id) ON DELETE CASCADE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT template_displays_nonempty CHECK (cardinality(allowed_displays) > 0),
    CONSTRAINT template_builtin_global CHECK (NOT is_builtin OR app_id IS NULL)
);

ALTER TABLE public.template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.template TO authenticated;

-- Built-ins are global and readable by any signed-in operator; an app-private template
-- is visible only to that app's members. No write policy: built-ins are migration-owned,
-- and user-authored templates arrive with slice 4.
CREATE POLICY template_select ON public.template FOR SELECT TO authenticated
    USING (app_id IS NULL OR public.is_app_member(app_id));

-- ── The 15 built-in config types ──────────────────────────────────────────────
-- Idempotent: re-applying updates copy + schema but never resurrects a deleted row's
-- app_id or flips is_builtin.
INSERT INTO public.template (id, display_name, description, allowed_displays, requires_ack, renders_ui, payload_schema) VALUES
('announcement','Announcement','News or launch message','{dialog,bottom_sheet,banner}',false,true,
 '{"type":"object","required":["title","body"],"properties":{"title":{"type":"string","maxLength":80},"body":{"type":"string","maxLength":600},"image_url":{"type":"string","format":"uri"},"cta_label":{"type":"string","maxLength":30},"cta_action":{"type":"string"}}}'),
('information','Information','Low-urgency informational note','{banner,inline}',false,true,
 '{"type":"object","required":["title","body"],"properties":{"title":{"type":"string","maxLength":80},"body":{"type":"string","maxLength":400},"severity":{"enum":["info","success","warning"],"default":"info"}}}'),
('notification','Notification','Actionable alert with a CTA','{dialog,bottom_sheet}',false,true,
 '{"type":"object","required":["title","body","cta_label","cta_action"],"properties":{"title":{"type":"string","maxLength":80},"body":{"type":"string","maxLength":400},"cta_label":{"type":"string","maxLength":30},"cta_action":{"type":"string"}}}'),
('update_available','Update available','Prompt or force an app update','{dialog,fullscreen}',false,true,
 '{"type":"object","required":["store_url","forced"],"properties":{"store_url":{"type":"string","format":"uri"},"forced":{"type":"boolean","default":false},"current_version":{"type":"string"},"release_notes":{"type":"string","maxLength":800}}}'),
('maintenance','Maintenance window','Scheduled downtime notice','{fullscreen,banner}',false,true,
 '{"type":"object","required":["title","body","window_start","window_end"],"properties":{"title":{"type":"string"},"body":{"type":"string"},"window_start":{"type":"string","format":"date-time"},"window_end":{"type":"string","format":"date-time"}}}'),
('promo_offer','Promotion / offer','Discount or trial offer','{bottom_sheet,fullscreen}',false,true,
 '{"type":"object","required":["headline","cta_label","cta_action"],"properties":{"headline":{"type":"string","maxLength":80},"body":{"type":"string","maxLength":400},"offer_code":{"type":"string","maxLength":40},"expires_at":{"type":"string","format":"date-time"},"cta_label":{"type":"string"},"cta_action":{"type":"string"}}}'),
('rating_prompt','Rating prompt','Ask for a store review','{dialog}',false,true,
 '{"type":"object","required":["title","body","store_url"],"properties":{"title":{"type":"string"},"body":{"type":"string"},"store_url":{"type":"string","format":"uri"}}}'),
('survey_nps','NPS survey','Single-question score survey','{bottom_sheet}',false,true,
 '{"type":"object","required":["question"],"properties":{"question":{"type":"string"},"scale_min":{"type":"integer","default":0},"scale_max":{"type":"integer","default":10},"follow_up":{"type":"string"}}}'),
('policy_update','Policy update','Terms change requiring acknowledgement','{fullscreen,dialog}',true,true,
 '{"type":"object","required":["title","summary","policy_url","effective_at"],"properties":{"title":{"type":"string"},"summary":{"type":"string","maxLength":600},"policy_url":{"type":"string","format":"uri"},"effective_at":{"type":"string","format":"date-time"}}}'),
('onboarding_tip','Onboarding tip','Contextual coachmark','{inline,banner}',false,true,
 '{"type":"object","required":["title","body"],"properties":{"title":{"type":"string","maxLength":60},"body":{"type":"string","maxLength":240},"anchor":{"type":"string"}}}'),
('paywall_upsell','Paywall / upsell','Subscription or purchase pitch','{fullscreen,bottom_sheet}',false,true,
 '{"type":"object","required":["headline","cta_label","cta_action"],"properties":{"headline":{"type":"string"},"benefits":{"type":"array","items":{"type":"string"}},"price_text":{"type":"string"},"cta_label":{"type":"string"},"cta_action":{"type":"string"}}}'),
('whats_new','What''s new','Release highlights','{bottom_sheet,fullscreen}',false,true,
 '{"type":"object","required":["version","items"],"properties":{"version":{"type":"string"},"items":{"type":"array","items":{"type":"string"},"minItems":1}}}'),
('incident_outage','Incident / outage','Live service problem','{banner,dialog}',false,true,
 '{"type":"object","required":["title","body"],"properties":{"title":{"type":"string"},"body":{"type":"string"},"status_url":{"type":"string","format":"uri"},"severity":{"enum":["info","warning","critical"],"default":"warning"}}}'),
('geo_notice','Regional notice','Region-specific legal or service notice','{dialog,banner}',false,true,
 '{"type":"object","required":["title","body","regions"],"properties":{"title":{"type":"string"},"body":{"type":"string"},"regions":{"type":"array","items":{"type":"string"},"minItems":1}}}'),
-- renders_ui=false + display "none": a value-only config. Frequency caps are meaningless
-- here, which migration 005's trigger and the /v1/configs serializer both respect.
('feature_flag','Feature flag','Value only — renders no UI','{none}',false,false,
 '{"type":"object","required":["key","value"],"properties":{"key":{"type":"string"},"value":{}}}')
ON CONFLICT (id) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  description      = EXCLUDED.description,
  payload_schema   = EXCLUDED.payload_schema,
  allowed_displays = EXCLUDED.allowed_displays,
  requires_ack     = EXCLUDED.requires_ack,
  renders_ui       = EXCLUDED.renders_ui,
  -- min_sdk_version and version were omitted, so a later migration bumping either — the
  -- very mechanism that "structurally removes the blank-surface class" — silently would
  -- not apply on re-run, while the comment above claimed re-applying updates the schema.
  min_sdk_version  = EXCLUDED.min_sdk_version,
  version          = EXCLUDED.version;
