-- ============================================================
-- 024 — prefill the authoring wizard from the template registry.
--
-- WHY THIS IS A MIGRATION AND NOT A DASHBOARD CHANGE
--
-- The prefill machinery already shipped. `dashboard/lib/schema-form.ts#defaultsFor()`
-- returns "the initial payload for a freshly-chosen template: every field whose schema
-- declares a `default`, and nothing else", and `components/AuthoringForm.tsx:143` calls it
-- on every template change (`if (!existing) setPayload(defaultsFor(fieldsFor(…)))` — so an
-- EDIT keeps the operator's own values and only a NEW config is seeded).
--
-- The reason the wizard still rendered empty boxes is that migration 004 declared only FOUR
-- defaults across all fifteen templates, and every one of them was a scalar or an enum:
-- information.severity, update_available.forced, survey_nps.scale_min/scale_max,
-- incident_outage.severity. Not a single TEXT field had one, so every operator wrote every
-- title, body and CTA from scratch. 004's own header says payload_schema "drives BOTH the
-- dashboard's generated form AND server-side write validation, so adding a config type is a
-- migration rather than a dashboard release" — by that same contract, adding the missing
-- defaults is a migration too.
--
-- JSON Schema `default` is an ANNOTATION, not a constraint: it cannot make a previously
-- valid payload invalid, so server-side validation is unaffected and this is safe to apply
-- to a live plane. `required` is untouched, so a default does not let an operator skip a
-- field — it gives them something to edit instead of a blank.
--
-- WHAT IS DELIBERATELY NOT DEFAULTED
--
-- Every `format: date-time` field — maintenance.window_start / window_end,
-- promo_offer.expires_at, policy_update.effective_at. A baked-in timestamp is stale the
-- moment it ships, and the failure is not cosmetic: a maintenance window in the past, or a
-- promotion that expired last month, published by an operator who trusted the prefill. An
-- empty datetime forces a real decision. Same reasoning for announcement.image_url (a
-- plausible-looking URL that 404s is worse than no image), onboarding_tip.anchor (only the
-- host app knows its own view ids) and feature_flag.value (untyped by design).
--
-- The copy below is app-NEUTRAL on purpose. The idea-layer's `demo_data.payload`
-- (idea-layer/screens/config-templates/ui.yaml) is deliberately Lumen-Photos-specific
-- because it feeds the Stitch mockups, where a concrete host app is the point. A wizard
-- default is the opposite job: it must read as an editable starting point in ANY consumer
-- app, so these say "Say what changed and why it matters" rather than naming a product.
--
-- Applying with jsonb_set rather than restating each schema: that way no existing
-- maxLength, format, enum or required clause can be dropped by a transcription slip. The
-- guard below also makes a typo'd field name a LOUD failure instead of a silent no-op that
-- would leave a default attached to a property the form never renders.
-- ============================================================

DO $$
DECLARE
    r           record;
    applied     int := 0;
    expected    int := 0;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- announcement
            ('announcement',     'title',          to_jsonb('Something new just landed'::text)),
            ('announcement',     'body',           to_jsonb('Say what changed and why it matters, in a sentence or two.'::text)),
            ('announcement',     'cta_label',      to_jsonb('Take a look'::text)),
            ('announcement',     'cta_action',     to_jsonb('app://home'::text)),
            -- information
            ('information',      'title',          to_jsonb('A quick heads-up'::text)),
            ('information',      'body',           to_jsonb('Share something users should know. No action needed.'::text)),
            -- notification
            ('notification',     'title',          to_jsonb('Your backup finished'::text)),
            ('notification',     'body',           to_jsonb('Tell the user what happened and what they can do next.'::text)),
            ('notification',     'cta_label',      to_jsonb('View'::text)),
            ('notification',     'cta_action',     to_jsonb('app://home'::text)),
            -- update_available
            ('update_available', 'current_version', to_jsonb('1.0.0'::text)),
            ('update_available', 'release_notes',  to_jsonb('What is fixed or faster in this release.'::text)),
            ('update_available', 'store_url',      to_jsonb('https://play.google.com/store/apps/details?id=com.example.app'::text)),
            -- maintenance (window_start / window_end intentionally absent — see header)
            ('maintenance',      'title',          to_jsonb('Back in about an hour'::text)),
            ('maintenance',      'body',           to_jsonb('Explain what is unavailable and reassure users their data is safe.'::text)),
            -- promo_offer (expires_at intentionally absent — see header)
            ('promo_offer',      'headline',       to_jsonb('Three months of Pro, half price'::text)),
            ('promo_offer',      'body',           to_jsonb('Say what they get and when the offer ends.'::text)),
            ('promo_offer',      'offer_code',     to_jsonb('WELCOME50'::text)),
            ('promo_offer',      'cta_label',      to_jsonb('Claim offer'::text)),
            ('promo_offer',      'cta_action',     to_jsonb('app://purchase'::text)),
            -- rating_prompt
            ('rating_prompt',    'title',          to_jsonb('Enjoying the app?'::text)),
            ('rating_prompt',    'body',           to_jsonb('A quick rating helps other people find it. It takes a few seconds.'::text)),
            ('rating_prompt',    'store_url',      to_jsonb('https://play.google.com/store/apps/details?id=com.example.app'::text)),
            -- survey_nps (scale_min / scale_max already defaulted in 004)
            ('survey_nps',       'question',       to_jsonb('How likely are you to recommend us to a friend or colleague?'::text)),
            ('survey_nps',       'follow_up',      to_jsonb('What is the main reason for your score?'::text)),
            -- policy_update (effective_at intentionally absent — see header)
            ('policy_update',    'title',          to_jsonb('We have updated our terms'::text)),
            ('policy_update',    'summary',        to_jsonb('Summarise what changed in plain language, and what it means for the user.'::text)),
            ('policy_update',    'policy_url',     to_jsonb('https://example.com/legal/terms'::text)),
            -- onboarding_tip (anchor intentionally absent — see header)
            ('onboarding_tip',   'title',          to_jsonb('Did you know?'::text)),
            ('onboarding_tip',   'body',           to_jsonb('Teach one thing in one sentence.'::text)),
            -- paywall_upsell
            ('paywall_upsell',   'headline',       to_jsonb('Everything, on every device'::text)),
            ('paywall_upsell',   'benefits',       to_jsonb(ARRAY['Unlimited storage','Automatic backup over Wi-Fi','No ads, ever'])),
            ('paywall_upsell',   'price_text',     to_jsonb('3.99/month after a 14-day free trial'::text)),
            ('paywall_upsell',   'cta_label',      to_jsonb('Start free trial'::text)),
            ('paywall_upsell',   'cta_action',     to_jsonb('app://purchase/pro-monthly'::text)),
            -- whats_new
            ('whats_new',        'version',        to_jsonb('1.1.0'::text)),
            ('whats_new',        'items',          to_jsonb(ARRAY['What you added','What you improved','What you fixed'])),
            -- incident_outage (severity already defaulted in 004)
            ('incident_outage',  'title',          to_jsonb('Sync is delayed'::text)),
            ('incident_outage',  'body',           to_jsonb('Say what is affected and reassure users nothing is lost.'::text)),
            ('incident_outage',  'status_url',     to_jsonb('https://status.example.com'::text)),
            -- geo_notice
            ('geo_notice',       'title',          to_jsonb('A note for users in your region'::text)),
            ('geo_notice',       'body',           to_jsonb('State who this applies to and what it means for them.'::text)),
            ('geo_notice',       'regions',        to_jsonb(ARRAY['EU'])),
            -- feature_flag (value intentionally absent — untyped by design)
            ('feature_flag',     'key',            to_jsonb('my_feature_flag'::text))
        ) AS v(tid, field, val)
    LOOP
        expected := expected + 1;

        -- The WHERE clause is the safety property: a default is attached ONLY to a property
        -- the schema already declares. A field name that does not exist updates zero rows,
        -- which the assertion below turns into a failed migration rather than a schema
        -- quietly carrying a default the form will never read.
        UPDATE public.template
           SET payload_schema = jsonb_set(
                   payload_schema,
                   ARRAY['properties', r.field, 'default'],
                   r.val,
                   true
               )
         WHERE id = r.tid
           AND payload_schema -> 'properties' ? r.field;

        IF FOUND THEN
            applied := applied + 1;
        ELSE
            RAISE EXCEPTION
                '024: template "%" has no payload_schema property "%" — refusing to attach a default to a field the form cannot render',
                r.tid, r.field;
        END IF;
    END LOOP;

    IF applied <> expected THEN
        RAISE EXCEPTION '024: applied % of % defaults', applied, expected;
    END IF;

    RAISE NOTICE '024: attached % payload defaults across the template registry', applied;
END $$;

-- Post-condition: every template that renders UI now seeds at least one text field, so no
-- operator meets a wholly empty form. feature_flag is excluded from the "text field" half of
-- that claim by design (renders_ui = false; its only defaulted field is `key`).
DO $$
DECLARE
    bare text[];
BEGIN
    SELECT array_agg(id ORDER BY id) INTO bare
      FROM public.template
     WHERE renders_ui
       AND NOT EXISTS (
             SELECT 1
               FROM jsonb_each(payload_schema -> 'properties') AS p(name, def)
              WHERE def ? 'default'
           );

    IF bare IS NOT NULL THEN
        RAISE EXCEPTION '024: UI-rendering template(s) still have no defaulted field: %', bare;
    END IF;
END $$;
