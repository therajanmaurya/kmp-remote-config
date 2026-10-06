package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.network.ConfigFetchResult
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Phase 01 / T2 — the transport talks to the control plane, and says so when it cannot.
 *
 * The old service built a Supabase client from a consumer-supplied url + anon key and read
 * `product_remote_config` over PostgREST, so none of the assertions below were even
 * expressible. Two of them matter beyond "it sends a request":
 *
 * - the HEADER TUPLE is what the deployed Edge Function authenticates and targets on. A
 *   missing `X-RC-SDK-Version` makes every template's min_sdk_version check fail and blacks
 *   out the whole product, which the server treats as a loud 403 rather than an empty list.
 * - a 403 must surface as a TYPED FAILURE, not an empty list. The old code caught everything
 *   and returned `emptyList()`, so a dead key and "nothing to show" were indistinguishable —
 *   the exact defect this product exists to remove.
 */
class RemoteConfigServiceTest {

    private val okBody = InlinedContractFixture.JSON

    private fun service(
        status: HttpStatusCode = HttpStatusCode.OK,
        body: String = okBody,
        capture: MutableList<Pair<String, String?>>? = null,
    ): RemoteConfigService {
        val engine = MockEngine { request ->
            capture?.addAll(
                listOf(
                    "url" to request.url.toString(),
                    "X-RC-Key" to request.headers["X-RC-Key"],
                    "X-RC-Package" to request.headers["X-RC-Package"],
                    "X-RC-Platform" to request.headers["X-RC-Platform"],
                    "X-RC-App-Version" to request.headers["X-RC-App-Version"],
                    "X-RC-SDK-Version" to request.headers["X-RC-SDK-Version"],
                ),
            )
            respond(
                content = body,
                status = status,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        return RemoteConfigService(
            baseUrl = "https://example.supabase.co/functions/v1",
            publishableKey = "rck_test_abc",
            packageName = "com.lumen.photos",
            platform = "android",
            appVersion = "4.3.0",
            httpClient = HttpClient(engine),
        )
    }

    @Test
    fun sends_the_full_identity_header_tuple() = runTest {
        val seen = mutableListOf<Pair<String, String?>>()
        service(capture = seen).fetchConfigs(screen = "home")

        val h = seen.toMap()
        assertEquals("rck_test_abc", h["X-RC-Key"])
        assertEquals("com.lumen.photos", h["X-RC-Package"])
        assertEquals("android", h["X-RC-Platform"])
        assertEquals("4.3.0", h["X-RC-App-Version"])
        assertTrue(
            !h["X-RC-SDK-Version"].isNullOrBlank(),
            "X-RC-SDK-Version must always be sent — the server 403s sdk_version_missing without it",
        )
        assertTrue(h["url"]!!.contains("/v1-configs"), "must call the control plane route")
        assertTrue(h["url"]!!.contains("screen=home"), "screen scoping travels as a query param")
    }

    @Test
    fun parses_a_successful_response_into_the_shipped_model() = runTest {
        val result = service().fetchConfigs(screen = "home")
        val ok = assertIs<ConfigFetchResult.Success>(result)
        assertEquals(2, ok.envelope.configs.size)
        assertEquals("update_available", ok.envelope.configs.first().template)
    }

    @Test
    fun a_403_is_a_typed_failure_carrying_the_server_code() = runTest {
        val result = service(
            status = HttpStatusCode.Forbidden,
            body = """{"error":"key_invalid"}""",
        ).fetchConfigs(screen = null)

        val failed = assertIs<ConfigFetchResult.Rejected>(result)
        assertEquals("key_invalid", failed.code)
        // The distinction that matters: a rejection is NOT an empty config set. An integrator
        // with a dead key must learn that, not watch their product silently show nothing.
    }

    @Test
    fun a_429_is_reported_as_rate_limited_rather_than_empty() = runTest {
        val result = service(
            status = HttpStatusCode.TooManyRequests,
            body = """{"error":"rate_limited","retry_after":42}""",
        ).fetchConfigs(screen = null)

        val failed = assertIs<ConfigFetchResult.Rejected>(result)
        assertEquals("rate_limited", failed.code)
    }

    @Test
    fun a_transport_error_fails_soft_but_distinguishably() = runTest {
        // A network blip must not crash the host app, but it also must not look like
        // "no configs". Unavailable is its own result so a caller can keep serving its cache.
        val engine = MockEngine { throw RuntimeException("boom") }
        val svc = RemoteConfigService(
            baseUrl = "https://example.supabase.co/functions/v1",
            publishableKey = "rck_test_abc",
            packageName = "com.lumen.photos",
            platform = "android",
            appVersion = "4.3.0",
            httpClient = HttpClient(engine),
        )
        assertIs<ConfigFetchResult.Unavailable>(svc.fetchConfigs(screen = null))
    }
}
