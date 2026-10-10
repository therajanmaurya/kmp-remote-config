package com.mobilebytelabs.remoteconfig.model

/**
 * A template id, as a type rather than a bare string.
 *
 * ── Why a type and not an enum ──────────────────────────────────────────────────────────────
 * An enum would close the set. The control plane can register custom templates per app, and a
 * template added there after this SDK shipped must still be nameable at a call site — otherwise
 * every new template becomes a mandatory SDK upgrade for the consumer, which is the forward
 * compatibility `UiNode.Unknown` and the generic renderer exist to preserve.
 *
 * So: constants for the fifteen builtins, giving autocomplete and compile-time safety for the
 * common case, and `RemoteConfigTemplate("my_custom_id")` as the escape hatch for everything else.
 *
 * ── Why not `@JvmInline value class` ────────────────────────────────────────────────────────
 * It was one, which costs nothing at runtime. Kotlin prohibits a vararg parameter of a value
 * class, and `RemoteConfigHost(RemoteConfigTemplate.UpdateAvailable, RemoteConfigTemplate.PolicyUpdate)` — naming
 * templates positionally, the way you would list them on paper — is the call shape this type
 * exists to serve. Fifteen allocations made once, in exchange for the API reading like the
 * thing it describes.
 *
 *     RemoteConfigHost(RemoteConfigTemplate.UpdateAvailable, RemoteConfigTemplate.PolicyUpdate)
 *     RemoteConfigHost(RemoteConfigTemplate("seasonal_banner"))          // custom, same thing
 *
 * ── These ids are the wire contract ─────────────────────────────────────────────────────────
 * Each value matches `template.id` in the control plane exactly. They are not display names and
 * must not be prettified: a mismatch here does not fail loudly, it just silently matches no
 * config, which is the hardest kind of bug to see in a feature whose correct behaviour is
 * frequently "show nothing".
 */
public data class RemoteConfigTemplate(public val id: String) {
    override fun toString(): String = id

    public companion object {
        /** News or a launch message. Dialog, bottom sheet or banner. */
        public val Announcement: RemoteConfigTemplate = RemoteConfigTemplate("announcement")

        /** A low-urgency note. Banner only. */
        public val Information: RemoteConfigTemplate = RemoteConfigTemplate("information")

        /** An actionable alert. Requires a CTA, which is what separates it from announcement. */
        public val Notification: RemoteConfigTemplate = RemoteConfigTemplate("notification")

        /** A new version is available; `forced` decides whether it can be dismissed. */
        public val UpdateAvailable: RemoteConfigTemplate = RemoteConfigTemplate("update_available")

        /** Terms changed. Requires acknowledgement, so the surface cannot be swiped away. */
        public val PolicyUpdate: RemoteConfigTemplate = RemoteConfigTemplate("policy_update")

        /** Subscription upsell. Fullscreen or bottom sheet. */
        public val PaywallUpsell: RemoteConfigTemplate = RemoteConfigTemplate("paywall_upsell")

        /** A time-boxed offer, optionally carrying a code. */
        public val PromoOffer: RemoteConfigTemplate = RemoteConfigTemplate("promo_offer")

        /** Release highlights. */
        public val WhatsNew: RemoteConfigTemplate = RemoteConfigTemplate("whats_new")

        /** Net promoter score, collected in-app. */
        public val SurveyNps: RemoteConfigTemplate = RemoteConfigTemplate("survey_nps")

        /** Sends the user to the store rather than collecting a score in-app. */
        public val RatingPrompt: RemoteConfigTemplate = RemoteConfigTemplate("rating_prompt")

        /** Degraded service, with an optional status page link. */
        public val IncidentOutage: RemoteConfigTemplate = RemoteConfigTemplate("incident_outage")

        /** A planned maintenance window. */
        public val Maintenance: RemoteConfigTemplate = RemoteConfigTemplate("maintenance")

        /** Region-restricted availability. */
        public val GeoNotice: RemoteConfigTemplate = RemoteConfigTemplate("geo_notice")

        /** A single tip, optionally anchored to a screen element. */
        public val OnboardingTip: RemoteConfigTemplate = RemoteConfigTemplate("onboarding_tip")

        /**
         * A value-only config: a key and a value, read through the typed getters.
         *
         * Listing it at a `RemoteConfigHost` call site does nothing by design — it renders no UI,
         * and the evaluator drops it before selection. It is here so the set is complete and so
         * that naming it is a no-op rather than a compile error someone works around.
         */
        public val FeatureFlag: RemoteConfigTemplate = RemoteConfigTemplate("feature_flag")

        /** Every builtin, in no particular order. */
        public val builtins: List<RemoteConfigTemplate> = listOf(
            Announcement, Information, Notification, UpdateAvailable, PolicyUpdate,
            PaywallUpsell, PromoOffer, WhatsNew, SurveyNps, RatingPrompt,
            IncidentOutage, Maintenance, GeoNotice, OnboardingTip, FeatureFlag,
        )
    }
}
