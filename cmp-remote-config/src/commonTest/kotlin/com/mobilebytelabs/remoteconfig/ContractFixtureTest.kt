package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The Kotlin half of the wire contract test. Its twin is
 * `supabase/functions/v1-configs/contract_test.ts`, and both assert
 * `contract/configs-response.json`.
 *
 * This pair is the entire reason the SDK, the backend and the dashboard share one repo:
 * a commit that changes the `/v1/configs` response shape without changing the SDK model
 * fails CI. It now deserializes into the SHIPPED [RemoteConfigEnvelope] — previously it
 * used private `WireEnvelope`/`WireConfig` classes that lived only in this file, so a
 * commit could change the wire shape and those two classes together and pass both suites
 * while the real SDK read something else entirely. That is precisely the drift that let the
 * dashboard and the device disagree for the whole life of the project.
 *
 * **Every wire field is asserted by VALUE, deliberately.** [RemoteConfigEnvelope] gives each
 * field a default so an older client tolerates a newer server, which means a RENAMED key
 * deserializes silently into its default instead of throwing. Asserting the values is what
 * makes a rename fail — a contract test that cannot fail is not a contract test.
 *
 * The fixture is inlined rather than read from disk because `commonTest` has no filesystem
 * on every target (js, wasmJs, native). `ContractFixtureFileTest` (jvmTest) proves this copy
 * has not drifted from the file the Deno twin asserts.
 */
class ContractFixtureTest {

    private val fixture = InlinedContractFixture.JSON

    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    private fun envelope(): RemoteConfigEnvelope = json.decodeFromString(fixture)

    @Test
    fun deserializes_the_control_plane_response_into_the_shipped_model() {
        val env = envelope()
        assertEquals(1, env.schemaVersion)
        assertEquals(2, env.configs.size)
    }

    @Test
    fun rendering_config_carries_every_field_the_host_reads() {
        val c = envelope().configs[0]
        assertEquals("0f9b7c1e-2a3d-4b5c-8d7e-1f2a3b4c5d6e", c.id)
        assertEquals("update_available", c.template)
        assertEquals(1, c.templateVersion)
        assertEquals("dialog", c.display)
        assertEquals(10, c.priority)
        assertTrue(c.rendersUi)
        assertFalse(c.requiresAck)
        assertEquals(1, c.version)
        assertTrue(c.isDismissible)
        assertEquals(1, c.maxImpressions)
        assertEquals(24, c.cooldownHours)
    }

    @Test
    fun the_payload_survives_as_an_opaque_object() {
        // The payload is template-shaped and deliberately NOT flattened into the model: the
        // builtins disagree about their fields, and update_available has no `title` at all.
        val payload = envelope().configs[0].payload
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.example.app",
            payload["store_url"]?.jsonPrimitive?.content,
        )
        assertEquals(false, payload["forced"]?.jsonPrimitive?.booleanOrNull)
    }

    @Test
    fun a_value_only_config_parses_and_declares_itself_unrenderable() {
        val c = envelope().configs[1]
        assertEquals("feature_flag", c.template)
        assertEquals("none", c.display)
        // The one field that matters for a value-only config. The server omits the frequency
        // fields here and the shipped model defaults them, which is harmless ONLY because
        // `renders_ui: false` stops it before any frequency rule is consulted — asserted
        // directly in RemoteConfigEvaluatorTest.
        assertFalse(c.rendersUi)
        assertEquals("new_search", c.payload["key"]?.jsonPrimitive?.content)
        assertEquals(true, c.payload["value"]?.jsonPrimitive?.booleanOrNull)
    }
}
