package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The `remoteConfig { }` DSL is the integration path the dashboard prints and the README
 * documents, so what it wires is what consumers actually get. These tests assert the headers
 * that leave the device through THAT path, not through a service a test constructed by hand.
 *
 * The motivating defect: the module registered a `DeviceIdProvider` singleton and then built
 * the service WITHOUT it. Every app integrating this way therefore sent no `X-RC-Device`, and
 * the server excludes an unidentified caller from any partial rollout — so a staged rollout
 * reached NOBODY, silently, for every consumer using the documented wiring. Nothing failed;
 * the feature simply did not work.
 */
class RemoteConfigDslTest {

    @AfterTest
    fun tearDown() = stopKoin()

    private val captured = mutableListOf<Pair<String, String?>>()

    private fun engine() = MockEngine { request ->
        captured += listOf(
            "X-RC-Key" to request.headers["X-RC-Key"],
            "X-RC-Package" to request.headers["X-RC-Package"],
            "X-RC-Platform" to request.headers["X-RC-Platform"],
            "X-RC-App-Version" to request.headers["X-RC-App-Version"],
            "X-RC-SDK-Version" to request.headers["X-RC-SDK-Version"],
            "X-RC-Device" to request.headers["X-RC-Device"],
        )
        respond(
            """{"schema_version":1,"configs":[],"parameters":{}}""",
            HttpStatusCode.OK,
            headersOf(HttpHeaders.ContentType, "application/json"),
        )
    }

    private fun koin(block: RemoteConfigBuilder.() -> Unit = {}) = startKoin {
        modules(
            module {
                remoteConfig {
                    publishableKey = "rck_test_dsl"
                    packageName = "com.mobilebytesensei.rconfig"
                    platform = "desktop"
                    appVersion = "1.2.3"
                    httpClient = HttpClient(engine())
                    block()
                }
            },
        )
    }

    @Test
    fun the_dsl_wires_a_device_id_so_a_staged_rollout_can_bucket_this_install() = runTest {
        val app = koin()
        app.koin.get<RemoteConfigService>().fetchConfigs(screen = null)

        val device = captured.toMap()["X-RC-Device"]
        assertTrue(
            !device.isNullOrBlank(),
            "the DSL must supply a device id — without it the server excludes this install from " +
                "every partial rollout, so a staged rollout reaches nobody",
        )
    }

    @Test
    fun the_device_id_is_stable_across_fetches() = runTest {
        // Bucketing is a pure function of (config, device). An id that changed per request
        // would re-roll membership on every poll — the "feature keeps flickering" bug that
        // reads as a product defect rather than a config one.
        val app = koin()
        val service = app.koin.get<RemoteConfigService>()
        service.fetchConfigs(screen = null)
        service.fetchConfigs(screen = null)

        val ids = captured.filter { it.first == "X-RC-Device" }.map { it.second }
        assertEquals(2, ids.size)
        assertEquals(ids[0], ids[1], "the device id must not change between fetches")
    }

    @Test
    fun the_dsl_sends_the_full_identity_tuple() = runTest {
        val app = koin()
        app.koin.get<RemoteConfigService>().fetchConfigs(screen = null)

        val h = captured.toMap()
        assertEquals("rck_test_dsl", h["X-RC-Key"])
        assertEquals("com.mobilebytesensei.rconfig", h["X-RC-Package"])
        assertEquals("desktop", h["X-RC-Platform"])
        assertEquals("1.2.3", h["X-RC-App-Version"])
        // Without this the server answers 403 sdk_version_missing rather than an empty set,
        // which blacks out the whole product.
        assertTrue(!h["X-RC-SDK-Version"].isNullOrBlank())
    }
}
