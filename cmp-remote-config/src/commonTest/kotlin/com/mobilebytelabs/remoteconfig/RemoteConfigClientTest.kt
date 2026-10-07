package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 03 / T3 — typed parameter getters.
 *
 * The product shipped values as a `feature_flag` config row with a free-form payload, so a
 * caller read `payload["value"]` and cast it themselves. These getters are the half that makes
 * a parameter a parameter: a declared type, and an IN-APP DEFAULT that applies before any
 * network call has succeeded.
 *
 * The in-app default is the one that matters most. An app's very first launch, offline, has no
 * server value for anything — if a getter returned null or false there, every feature gated on
 * a flag would be silently off for every new install until a fetch landed.
 */
class RemoteConfigClientTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun client(serverJson: String?, defaults: Map<String, Any> = emptyMap()): RemoteConfigClient {
        val c = RemoteConfigClient(
            defaults = buildJsonObject {
                for ((k, v) in defaults) when (v) {
                    is Boolean -> put(k, v)
                    is Int -> put(k, v)
                    is Long -> put(k, v)
                    is String -> put(k, v)
                    else -> error("unsupported default in test: $v")
                }
            },
        )
        if (serverJson != null) {
            c.accept(json.decodeFromString<RemoteConfigEnvelope>(serverJson))
        }
        return c
    }

    @Test
    fun a_server_value_wins_over_the_in_app_default() {
        val c = client(
            """{"schema_version":1,"configs":[],"parameters":{"welcome_banner_enabled":true,"max_uploads":50,"theme":"dark"}}""",
            defaults = mapOf("welcome_banner_enabled" to false, "max_uploads" to 5, "theme" to "light"),
        )
        assertEquals(true, c.getBoolean("welcome_banner_enabled"))
        assertEquals(50L, c.getLong("max_uploads"))
        assertEquals("dark", c.getString("theme"))
    }

    @Test
    fun the_in_app_default_applies_before_any_fetch_has_landed() {
        // No envelope accepted at all — a cold first launch, offline.
        val c = client(null, defaults = mapOf("welcome_banner_enabled" to true, "max_uploads" to 5))
        assertEquals(true, c.getBoolean("welcome_banner_enabled"))
        assertEquals(5L, c.getLong("max_uploads"))
    }

    @Test
    fun a_key_the_server_omits_falls_back_rather_than_vanishing() {
        val c = client(
            """{"schema_version":1,"configs":[],"parameters":{"theme":"dark"}}""",
            defaults = mapOf("max_uploads" to 5),
        )
        assertEquals(5L, c.getLong("max_uploads"))
        assertEquals("dark", c.getString("theme"))
    }

    @Test
    fun an_unknown_key_with_no_default_is_null_not_a_guess() {
        val c = client("""{"schema_version":1,"configs":[],"parameters":{}}""")
        assertNull(c.getString("never_declared"))
        assertNull(c.getBoolean("never_declared"))
        assertNull(c.getLong("never_declared"))
    }

    @Test
    fun a_type_mismatch_falls_back_instead_of_throwing() {
        // The server says "dark" for a key the app reads as a boolean — a dashboard mistake,
        // or an app that changed a parameter's type between releases. Throwing here would
        // crash the host app over a config value, which is never the right trade.
        val c = client(
            """{"schema_version":1,"configs":[],"parameters":{"theme":"dark"}}""",
            defaults = mapOf("theme" to false),
        )
        assertEquals(false, c.getBoolean("theme"))
    }

    @Test
    fun json_parameters_are_returned_whole() {
        val c = client("""{"schema_version":1,"configs":[],"parameters":{"tiers":{"gold":10,"silver":5}}}""")
        val tiers = c.getJson("tiers")
        assertTrue(tiers != null && tiers.containsKey("gold"))
        assertEquals(JsonPrimitive(10), tiers?.get("gold"))
    }
}
