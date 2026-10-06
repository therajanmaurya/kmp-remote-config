package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Phase 01 / T1 — the SHIPPED wire model deserializes the real `/v1/configs` fixture.
 *
 * This is the test `ContractFixtureTest` should always have been. That one declares private
 * `WireEnvelope`/`WireConfig` stand-ins and carries a `slice-3` marker admitting they are not
 * the production types — so a commit that changed the wire shape AND those two classes
 * together passed both suites while the real SDK model drifted away from the server. It did:
 * the shipped `RemoteConfig` is the KmpToolkit 3.5.28 flat schema and cannot parse this
 * fixture at all.
 *
 * Asserting with `RemoteConfigEnvelope` (production) is what makes the one-repo topology
 * worth anything.
 */
class RemoteConfigEnvelopeTest {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Test
    fun deserializes_the_contract_fixture_into_the_shipped_model() {
        val envelope = json.decodeFromString<RemoteConfigEnvelope>(InlinedContractFixture.JSON)

        assertEquals(1, envelope.schemaVersion, "schema_version must map to schemaVersion")
        assertEquals(2, envelope.configs.size, "the fixture carries two configs")
    }

    @Test
    fun maps_the_template_and_payload_of_a_ui_config() {
        val envelope = json.decodeFromString<RemoteConfigEnvelope>(InlinedContractFixture.JSON)
        val update = envelope.configs.first { it.template == "update_available" }

        // `template`, NOT `template_id` — the server emits `template`, and getting this wrong
        // is exactly the drift this test exists to catch.
        assertEquals("update_available", update.template)
        assertEquals("dialog", update.display)
        assertEquals(10, update.priority)
        assertTrue(update.rendersUi)
        assertFalse(update.requiresAck)
        assertTrue(update.isDismissible)
        assertEquals(1, update.maxImpressions)
        assertEquals(24, update.cooldownHours)

        // The payload is an opaque JSON object validated server-side against the template's
        // payload_schema. The SDK must not flatten it into named fields — that flattening is
        // what made the old model unable to carry anything but announcement-shaped configs.
        val storeUrl = update.payload["store_url"]
        assertNotNull(storeUrl, "payload must retain store_url")
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.example.app",
            storeUrl.jsonPrimitive.content,
        )
        assertEquals(false, update.payload["forced"]?.jsonPrimitive?.content?.toBoolean())
    }

    @Test
    fun maps_a_value_only_config_that_renders_nothing() {
        val envelope = json.decodeFromString<RemoteConfigEnvelope>(InlinedContractFixture.JSON)
        val flag = envelope.configs.first { it.template == "feature_flag" }

        assertEquals("none", flag.display)
        assertFalse(flag.rendersUi, "a feature flag renders no UI")
        assertEquals("new_search", flag.payload["key"]?.jsonPrimitive?.content)
        assertEquals("true", flag.payload["value"]?.jsonPrimitive?.content)

        // Frequency fields are absent for a value-only config and must default rather than
        // throw — the server omits them because they are meaningless here.
        assertEquals(1, flag.maxImpressions)
        assertEquals(24, flag.cooldownHours)
    }

    @Test
    fun an_unknown_field_does_not_break_parsing() {
        // Forward compatibility: the server may add a field before the SDK knows it, and a
        // client that throws on an unknown key turns an additive server change into a
        // total outage on every device running the older SDK.
        val withExtra = InlinedContractFixture.JSON.replace(
            "\"schema_version\":1",
            "\"schema_version\":1,\"server_hint\":\"future\"",
        )
        val envelope = json.decodeFromString<RemoteConfigEnvelope>(withExtra)
        assertEquals(2, envelope.configs.size)
    }
}
