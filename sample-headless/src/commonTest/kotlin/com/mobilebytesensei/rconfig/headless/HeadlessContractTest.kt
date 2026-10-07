package com.mobilebytesensei.rconfig.headless

import com.mobilebytelabs.remoteconfig.model.SdkSettings
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The headless contract: everything a server, CLI or watch complication needs is reachable
 * WITHOUT the Compose artefact.
 *
 * The module's build file enforces the dependency half — it declares only
 * `:cmp-remote-config`, applies neither Compose plugin, and targets linuxX64, mingwX64,
 * watchosArm64 and tvosArm64, none of which Compose Multiplatform publishes for. If the core
 * ever acquired a Compose dependency this module would stop compiling, which is a guarantee no
 * test of the library's own source can give.
 *
 * These tests cover the BEHAVIOUR half, and they are weighted towards the polling loop a
 * backend actually runs: it must be able to back off and to be switched off from cache, because
 * that is the moment an operator reaches for the switch.
 */
class HeadlessContractTest {

    private fun engine(body: String = """{"schema_version":1,"configs":[],"parameters":{}}""", status: HttpStatusCode = HttpStatusCode.OK) =
        MockEngine { respond(body, status, headersOf(HttpHeaders.ContentType, "application/json")) }

    private fun config(client: HttpClient = HttpClient(engine())) = HeadlessConfig(
        publishableKey = "rck_test_headless",
        platform = "linux",
        appVersion = "1.0.0",
        httpClient = client,
    )

    @Test
    fun bundled_defaults_are_readable_before_any_fetch() {
        // The first tick of a server process. Without defaults a backend would start with no
        // rate limit and no feature tier at all.
        val c = config()
        assertFalse(c.maintenanceMode)
        assertEquals(60L, c.rateLimitPerMinute)
        assertEquals("standard", c.featureTier)
    }

    @Test
    fun a_cached_kill_switch_suppresses_the_fetch_with_no_network() {
        val c = config()
        c.restoreSettings(SdkSettings(enabled = false))
        assertFalse(
            c.shouldFetch(lastFetchAtMs = 0L, nowMs = 10_000_000L),
            "a disabled app must make no request, learned from CACHE rather than from a fetch it cannot complete",
        )
    }

    @Test
    fun a_first_tick_fetches_immediately_then_respects_the_interval() {
        val c = config()
        c.restoreSettings(SdkSettings(enabled = true, fetchIntervalSeconds = 600))
        assertTrue(c.shouldFetch(lastFetchAtMs = null, nowMs = 0L), "nothing to measure an interval from")
        assertFalse(c.shouldFetch(lastFetchAtMs = 0L, nowMs = 599_000L))
        assertTrue(c.shouldFetch(lastFetchAtMs = 0L, nowMs = 600_001L))
    }

    @Test
    fun the_client_floor_overrides_a_smaller_server_interval() {
        // A self-hosted plane, or a row written before the database CHECK existed.
        val c = config()
        c.restoreSettings(SdkSettings(fetchIntervalSeconds = 1))
        assertFalse(c.shouldFetch(lastFetchAtMs = 0L, nowMs = 1_500L))
    }

    @Test
    fun a_successful_fetch_replaces_the_defaults() = runTest {
        val c = config(HttpClient(engine("""{"schema_version":1,"configs":[],"parameters":{"maintenance_mode":true,"rate_limit_per_minute":5,"feature_tier":"pro"}}""")))
        assertNull(c.refresh(), "a 200 should report no failure")
        assertTrue(c.maintenanceMode)
        assertEquals(5L, c.rateLimitPerMinute)
        assertEquals("pro", c.featureTier)
    }

    @Test
    fun a_refusal_is_returned_rather_than_swallowed() = runTest {
        // The defect the 5.0.0 transport removed: a revoked key and "nothing configured" must
        // never look the same to whoever reads the log.
        val c = config(HttpClient(engine("""{"error":"key_invalid"}""", HttpStatusCode.Forbidden)))
        assertEquals("key_invalid", c.refresh())
        // …and the values stay on their defaults rather than becoming null.
        assertEquals(60L, c.rateLimitPerMinute)
    }

    @Test
    fun a_key_the_server_stops_sending_falls_back_to_the_bundled_default() = runTest {
        val c = config(HttpClient(engine("""{"schema_version":1,"configs":[],"parameters":{"feature_tier":"pro"}}""")))
        assertNull(c.refresh())
        assertEquals("pro", c.featureTier)
        // An operator deletes the parameter; the next fetch simply omits it.
        val c2 = config(HttpClient(engine("""{"schema_version":1,"configs":[],"parameters":{}}""")))
        assertNull(c2.refresh())
        assertEquals("standard", c2.featureTier)
    }
}
