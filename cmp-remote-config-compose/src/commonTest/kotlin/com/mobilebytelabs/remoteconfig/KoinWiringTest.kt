package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.local.DeviceIdProvider
import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import com.mobilebytelabs.remoteconfig.ui.RefreshTicker
import com.mobilebytelabs.remoteconfig.ui.RemoteConfigViewModel
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import org.koin.dsl.koinApplication
import org.koin.dsl.module
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * The Koin module can actually build everything it promises.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 * This is the THIRD defect of one shape to reach a running app. Every other test in this module
 * constructs objects directly, so none of them touch the container — and the container is where
 * integration actually happens, because `remoteConfig { }` is the documented and only setup path.
 *
 *   1. The service was built without the `deviceId` the module had already registered, so every
 *      app integrating through the DSL sent no `X-RC-Device` — and the server excludes an
 *      unidentified caller from a PARTIAL rollout. Staged rollout reached nobody, silently.
 *   2. A defaulted `ticker` parameter was added to the ViewModel. Source-compatible for direct
 *      callers, which is how every test builds it — and a `NoDefinitionFoundException` on first
 *      launch, because `viewModelOf` resolves EVERY parameter through Koin and ignores Kotlin
 *      defaults.
 *
 * Both were green suites and a crash (or worse, a silence) on the device. Resolving each
 * definition here is cheap and catches the whole class.
 *
 * The ViewModel is the one that matters most: `viewModelOf(::RemoteConfigViewModel)` is a
 * constructor reference, so ANY parameter added to it without a matching definition fails here
 * rather than at the first composition.
 *
 * In `commonTest`, not `jvmTest`. A missing DEFINITION cannot be platform-specific, but the
 * `single { }` lambdas run platform code — `RemoteConfigLocalStore()` and `DeviceIdProvider()`
 * both reach `defaultSettings()`, which is `expect`/`actual`. A JVM-only run would leave the
 * one part of this graph that genuinely differs per target unexercised on every target but one.
 *
 * `runTest` rather than `runBlocking`: the latter does not exist on JS or wasm. There is no
 * virtual-clock hazard here because `fetchConfigs` has no `withTimeoutOrNull` of its own — the
 * budget lives in the ViewModel, which this test does not drive.
 */
class KoinWiringTest {

    /** Requests the DI-built service actually made, so wiring can be checked by its effect. */
    private val seen = mutableListOf<Map<String, String?>>()

    private fun app() = koinApplication {
        modules(
            module {
                remoteConfig {
                    publishableKey = "rck_test_abc"
                    packageName = "com.example.app"
                    platform = "android"
                    appVersion = "1.0.0"
                    httpClient = HttpClient(
                        MockEngine { request ->
                            seen += mapOf(
                                "X-RC-Device" to request.headers["X-RC-Device"],
                                "X-RC-Key" to request.headers["X-RC-Key"],
                                "X-RC-Package" to request.headers["X-RC-Package"],
                            )
                            respond(
                                content = """{"schema_version":1,"configs":[]}""",
                                status = HttpStatusCode.OK,
                                headers = headersOf(HttpHeaders.ContentType, "application/json"),
                            )
                        },
                    )
                }
            },
        )
    }

    @Test
    fun the_view_model_resolves_from_the_module() {
        // The assertion that would have caught the ticker regression. `viewModelOf` is a
        // constructor reference: a new parameter with no definition fails right here.
        val koin = app()
        try {
            assertNotNull(koin.koin.get<RemoteConfigViewModel>())
        } finally {
            koin.close()
        }
    }

    @Test
    fun every_definition_the_module_declares_can_be_built() {
        // Not just the ViewModel: a broken binding anywhere in the graph is the same class of
        // bug, and the service is where the deviceId one hid.
        val koin = app()
        try {
            assertNotNull(koin.koin.get<RemoteConfigService>())
            assertNotNull(koin.koin.get<RemoteConfigEvaluator>())
            assertNotNull(koin.koin.get<RemoteConfigLocalStore>())
            assertNotNull(koin.koin.get<DeviceIdProvider>())
            assertNotNull(koin.koin.get<RefreshTicker>())
        } finally {
            koin.close()
        }
    }

    @Test
    fun two_resolutions_of_the_view_model_share_one_service() {
        // The singletons must be singletons. Two services would mean two fetch schedules, two
        // caches, and impression counts split across both — the kind of thing that looks like a
        // flaky server rather than a DI mistake.
        val koin = app()
        try {
            assertNotNull(koin.koin.get<RemoteConfigService>())
            val a = koin.koin.get<RemoteConfigService>()
            val b = koin.koin.get<RemoteConfigService>()
            kotlin.test.assertSame(a, b, "the service is not a singleton")
        } finally {
            koin.close()
        }
    }

    @Test
    fun the_di_built_service_sends_the_identity_the_module_registered() = runTest {
        // Defect #1 was NOT a missing definition — the service resolved perfectly and was simply
        // handed no deviceId, so `X-RC-Device` went unsent and the server excluded the caller
        // from every partial rollout. Resolving a definition proves it exists; only using it
        // proves it was wired with the right values.
        //
        // The DeviceIdProvider is registered in the same module, so this asserts the two halves
        // were actually joined rather than merely both present.
        val koin = app()
        try {
            koin.koin.get<RemoteConfigService>().fetchConfigs(screen = null)

            val headers = seen.single()
            assertNotNull(
                headers["X-RC-Device"],
                "the DI-built service sent no X-RC-Device — a staged rollout would reach nobody, " +
                    "silently, through the documented integration path",
            )
            assertEquals("rck_test_abc", headers["X-RC-Key"])
            assertEquals("com.example.app", headers["X-RC-Package"])
        } finally {
            koin.close()
        }
    }
}
