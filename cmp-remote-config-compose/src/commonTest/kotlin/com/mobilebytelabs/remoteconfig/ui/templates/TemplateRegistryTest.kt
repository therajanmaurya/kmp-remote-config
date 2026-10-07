package com.mobilebytelabs.remoteconfig.ui.templates

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The nine `config-templates` mockups became per-template bodies. These tests pin the two
 * properties that decide whether that work holds up:
 *
 *  1. every builtin that RENDERS has a designed body — a builtin without one falls through to
 *     the generic role-guessing presentation, which is the behaviour the mockups exist to replace;
 *  2. an UNKNOWN template still falls through rather than failing — otherwise every template
 *     added to the control plane after this SDK ships becomes a mandatory upgrade.
 */
class TemplateRegistryTest {

    /**
     * The rendering builtins, as the live control plane declares them (migration 004, verified
     * against prod 2026-10-07). `feature_flag` is excluded deliberately: `renders_ui = false`,
     * so it is read through the typed getters and must NEVER have a body.
     */
    private val renderingBuiltins = listOf(
        "announcement", "geo_notice", "incident_outage", "information", "maintenance",
        "notification", "onboarding_tip", "paywall_upsell", "policy_update", "promo_offer",
        "rating_prompt", "survey_nps", "update_available", "whats_new",
    )

    @Test
    fun every_rendering_builtin_has_a_designed_body() {
        val missing = renderingBuiltins.filterNot { hasDesignedBody(it) }
        assertTrue(
            missing.isEmpty(),
            "these rendering builtins would fall back to the generic body: $missing",
        )
    }

    @Test
    fun the_value_only_builtin_has_no_body() {
        // A body for feature_flag would be a surface for something that must never be drawn.
        assertFalse(hasDesignedBody("feature_flag"))
    }

    @Test
    fun an_unknown_template_falls_through_instead_of_failing() {
        // A template authored in the dashboard after this SDK shipped, or a custom one.
        assertFalse(hasDesignedBody("some_future_template"))
        assertFalse(hasDesignedBody(""))
    }

    @Test
    fun the_registry_covers_exactly_the_rendering_builtins() {
        // Guards the other direction: a stray key would mean a body nothing can ever reach.
        assertEquals(renderingBuiltins.sorted(), TEMPLATE_BODIES.keys.sorted())
    }
}

/**
 * The payload reader is where the old generic body actually failed: it looked for `title` and
 * `body` on every template, so `update_available` (store_url / forced / release_notes /
 * current_version — no title at all) rendered an empty overlay.
 */
class TemplatePayloadTest {

    private fun payload(raw: String) = TemplatePayload(Json.decodeFromString<JsonObject>(raw))

    @Test
    fun reads_the_fields_a_templates_own_schema_declares() {
        val p = payload("""{"store_url":"https://play.google.com/x","forced":true,"current_version":"4.9.0"}""")
        assertEquals("https://play.google.com/x", p.string("store_url"))
        assertTrue(p.bool("forced"))
        assertEquals("4.9.0", p.string("current_version"))
    }

    @Test
    fun a_missing_field_is_absent_rather_than_fatal() {
        // The payload is authored in a dashboard and validated by a schema the DEVICE never
        // sees. A reader that threw would turn an operator's typo into a crash in the host app.
        val p = payload("""{}""")
        assertNull(p.string("title"))
        assertEquals("fallback", p.string("title", "fallback"))
        assertFalse(p.bool("forced"))
        assertEquals(10, p.int("scale_max", 10))
        assertEquals(emptyList(), p.strings("items"))
    }

    @Test
    fun a_wrongly_typed_field_falls_back_instead_of_throwing() {
        // `forced` as a string, `scale_max` as a word — both reachable through the API, and
        // neither should take down the surface.
        val p = payload("""{"forced":"yes","scale_max":"ten","title":42}""")
        assertFalse(p.bool("forced"))
        assertEquals(10, p.int("scale_max", 10))
        assertNull(p.string("title"))
    }

    @Test
    fun blank_strings_are_treated_as_absent() {
        // An operator clearing a field leaves "" behind. Rendering an empty heading is worse
        // than falling back to the template's default copy.
        val p = payload("""{"title":"   ","body":""}""")
        assertNull(p.string("title"))
        assertEquals("Announcement", p.string("title", "Announcement"))
        assertNull(p.string("body"))
    }

    @Test
    fun string_arrays_skip_non_string_entries() {
        // benefits / items / regions. A mixed array is an authoring mistake, not a reason to
        // drop the whole list.
        val p = payload("""{"items":["Faster sync", 7, null, "Raw export", ""]}""")
        assertEquals(listOf("Faster sync", "Raw export"), p.strings("items"))
    }

    @Test
    fun an_array_field_read_as_a_string_is_null_not_a_rendered_object() {
        val p = payload("""{"benefits":["a","b"]}""")
        assertNull(p.string("benefits"))
    }
}
