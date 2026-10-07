package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Phase 04 / T2 — bundled defaults, and the three-layer precedence around them (AC-16).
 *
 * `server > cache > bundled default`, and each layer exists for a distinct moment:
 *
 *  - **bundled** is the only thing present on a first launch with no network. Without it a
 *    brand-new install shows nothing — strictly worse than having no remote config at all,
 *    because the app has been built assuming the values are there.
 *  - **cache** covers every later offline launch. Falling past it to the bundled default would
 *    silently revert a user to shipping-day behaviour the moment a flight turns wifi off.
 *  - **server** is the live answer and wins whenever it has one.
 */
class RemoteConfigDefaultsTest {

    private val json = Json { ignoreUnknownKeys = true }

    private val bundled = remoteConfigDefaults {
        boolean("welcome_banner_enabled", false)
        long("max_uploads", 5)
        string("theme", "light")
    }

    @Test
    fun a_cold_first_launch_with_no_network_serves_the_bundled_defaults() {
        val c = RemoteConfigClient(defaults = bundled)
        assertEquals(false, c.getBoolean("welcome_banner_enabled"))
        assertEquals(5L, c.getLong("max_uploads"))
        assertEquals("light", c.getString("theme"))
    }

    @Test
    fun a_cached_value_beats_the_bundled_default_on_a_later_offline_launch() {
        val c = RemoteConfigClient(defaults = bundled)
        // Restored from disk at startup; no fetch has succeeded this launch.
        c.acceptCached(remoteConfigDefaults { long("max_uploads", 50) })
        assertEquals(50L, c.getLong("max_uploads"))
        // A key the cache does not carry still falls through to bundled.
        assertEquals("light", c.getString("theme"))
    }

    @Test
    fun a_successful_fetch_beats_both() {
        val c = RemoteConfigClient(defaults = bundled)
        c.acceptCached(remoteConfigDefaults { long("max_uploads", 50) })
        c.accept(
            json.decodeFromString<RemoteConfigEnvelope>(
                """{"schema_version":1,"configs":[],"parameters":{"max_uploads":500,"theme":"dark"}}""",
            ),
        )
        assertEquals(500L, c.getLong("max_uploads"))
        assertEquals("dark", c.getString("theme"))
        // Still falls back for a key nobody has a server value for.
        assertEquals(false, c.getBoolean("welcome_banner_enabled"))
    }

    @Test
    fun the_server_removing_a_key_falls_back_rather_than_stranding_a_stale_value() {
        // An operator deletes a parameter. The next fetch simply omits it. The SDK must land
        // on the bundled default, not keep serving a value the dashboard no longer has.
        val c = RemoteConfigClient(defaults = bundled)
        c.accept(json.decodeFromString<RemoteConfigEnvelope>(
            """{"schema_version":1,"configs":[],"parameters":{"theme":"dark"}}""",
        ))
        assertEquals("dark", c.getString("theme"))
        c.accept(json.decodeFromString<RemoteConfigEnvelope>(
            """{"schema_version":1,"configs":[],"parameters":{}}""",
        ))
        assertEquals("light", c.getString("theme"))
    }
}
