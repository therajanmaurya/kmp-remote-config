package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import com.mobilebytelabs.remoteconfig.model.SdkSettings
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Phase 04 / T1 — server-delivered settings, and the two properties that make them safe.
 *
 * **The kill switch must work OFFLINE.** A switch honoured only on a successful fetch fails in
 * the exact scenario it exists for: the SDK is hammering a struggling server, or an
 * integration is misbehaving, and the operator flips `enabled = false`. If the client only
 * learns that from a fetch it cannot complete, the switch is decoration. So the last known
 * settings are cached and consulted BEFORE deciding to fetch.
 *
 * **The client keeps its own floor.** Bounds in the database stop an operator typing 1 second,
 * but the SDK also talks to self-hosted planes and to older rows written before a CHECK
 * existed. A compiled-in floor cannot be withdrawn by the thing it is protecting against.
 */
class RemoteConfigSettingsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun settings_arrive_in_the_envelope_and_are_defaulted_when_absent() {
        // An older server sends no `settings` key at all; the SDK must keep working.
        val old = json.decodeFromString<RemoteConfigEnvelope>("""{"schema_version":1,"configs":[]}""")
        assertTrue(old.settings.enabled, "an absent settings block must not read as disabled")

        val env = json.decodeFromString<RemoteConfigEnvelope>(
            """{"schema_version":1,"configs":[],"settings":{"enabled":false,"fetch_interval_seconds":900,"cache_ttl_seconds":3600,"max_retries":5,"backoff_base_seconds":4}}""",
        )
        assertFalse(env.settings.enabled)
        assertEquals(900, env.settings.fetchIntervalSeconds)
        assertEquals(5, env.settings.maxRetries)
    }

    @Test
    fun a_cached_kill_switch_stops_a_fetch_even_with_no_network() {
        // G-6a. The client has previously seen enabled=false; this launch is offline.
        val client = RemoteConfigClient()
        client.acceptSettings(SdkSettings(enabled = false))
        assertFalse(
            client.shouldFetch(lastFetchAtMs = 0L, nowMs = 10_000_000L),
            "a cached kill switch must suppress the fetch without needing a successful fetch to learn it",
        )
    }

    @Test
    fun the_client_floor_wins_over_a_smaller_server_interval() {
        val client = RemoteConfigClient()
        client.acceptSettings(SdkSettings(fetchIntervalSeconds = 1))

        // One second after the last fetch, the server's interval would allow another. The
        // floor must not.
        assertFalse(
            client.shouldFetch(lastFetchAtMs = 0L, nowMs = 1_500L),
            "a 1s server interval must be clamped to the client floor",
        )
        assertTrue(client.shouldFetch(lastFetchAtMs = 0L, nowMs = 120_000L))
    }

    @Test
    fun a_first_launch_fetches_immediately() {
        // No last-fetch timestamp at all: the interval has nothing to measure from, and
        // waiting an hour before the first fetch would make a cold install useless.
        val client = RemoteConfigClient()
        assertTrue(client.shouldFetch(lastFetchAtMs = null, nowMs = 0L))
    }

    @Test
    fun an_enabled_app_fetches_once_the_interval_has_elapsed() {
        val client = RemoteConfigClient()
        client.acceptSettings(SdkSettings(enabled = true, fetchIntervalSeconds = 600))
        assertFalse(client.shouldFetch(lastFetchAtMs = 0L, nowMs = 599_000L))
        assertTrue(client.shouldFetch(lastFetchAtMs = 0L, nowMs = 600_001L))
    }
}
