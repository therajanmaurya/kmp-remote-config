package com.mobilebytelabs.remoteconfig

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Kotlin half of the wire contract test. Its twin is
 * `supabase/functions/v1-configs/contract_test.ts`, and both assert
 * `contract/configs-response.json`.
 *
 * This pair is the entire reason the SDK, the backend and the dashboard share one repo:
 * a commit that changes the `/v1/configs` response shape without changing this model fails
 * CI. Without it, the one-repo topology buys nothing.
 *
 * The fixture is inlined rather than read from disk because `commonTest` has no filesystem
 * on every target (js, wasmJs, native). A drifted copy FAILS this test, which is the point —
 * the Deno twin asserts the same bytes against the serializer that produces them.
 */
@Serializable
private data class WireEnvelope(
    @SerialName("schema_version") val schemaVersion: Int,
    val configs: List<WireConfig>,
)

@Serializable
private data class WireConfig(
    val id: String,
    val template: String,
    @SerialName("template_version") val templateVersion: Int,
    val display: String,
    val payload: JsonElement,
    val priority: Int,
    @SerialName("renders_ui") val rendersUi: Boolean,
    @SerialName("requires_ack") val requiresAck: Boolean,
    val version: Int,
    // Absent for a non-rendering config — frequency is meaningless without a surface,
    // so these are nullable rather than defaulted, and the test asserts they arrive null.
    @SerialName("is_dismissible") val isDismissible: Boolean? = null,
    @SerialName("max_impressions") val maxImpressions: Int? = null,
    @SerialName("cooldown_hours") val cooldownHours: Int? = null,
)

class ContractFixtureTest {

    // Shared with ContractFixtureFileTest (jvmTest), which proves this copy has not drifted
    // from contract/configs-response.json. Without that check this string could go stale
    // while still passing.
    private val fixture = InlinedContractFixture.JSON

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Test
    fun deserializes_the_control_plane_response() {
        val env = json.decodeFromString<WireEnvelope>(fixture)
        assertEquals(1, env.schemaVersion)
        assertEquals(2, env.configs.size)
    }

    @Test
    fun rendering_config_carries_frequency_fields() {
        val c = json.decodeFromString<WireEnvelope>(fixture).configs[0]
        assertEquals("update_available", c.template)
        assertEquals("dialog", c.display)
        assertTrue(c.rendersUi)
        assertEquals(1, c.maxImpressions)
        assertEquals(24, c.cooldownHours)
        assertEquals(true, c.isDismissible)
    }

    @Test
    fun feature_flag_omits_frequency_fields() {
        val c = json.decodeFromString<WireEnvelope>(fixture).configs[1]
        assertEquals("feature_flag", c.template)
        assertEquals("none", c.display)
        assertFalse(c.rendersUi)
        // The server drops these for a non-rendering template, so the client must tolerate
        // their absence rather than defaulting them to a cap it then tries to honour.
        assertNull(c.maxImpressions)
        assertNull(c.cooldownHours)
        assertNull(c.isDismissible)
    }
}
