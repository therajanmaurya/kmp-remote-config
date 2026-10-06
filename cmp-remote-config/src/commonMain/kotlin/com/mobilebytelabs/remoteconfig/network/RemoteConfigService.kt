package com.mobilebytelabs.remoteconfig.network

import co.touchlab.kermit.Logger
import com.mobilebytelabs.remoteconfig.cmpMetadata
import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val TAG = "RemoteConfigService"

/** The outcome of a config fetch. Three states, deliberately — see [ConfigFetchResult.Rejected]. */
sealed interface ConfigFetchResult {
    /** The server answered. `envelope.configs` may legitimately be empty. */
    data class Success(val envelope: RemoteConfigEnvelope) : ConfigFetchResult

    /**
     * The server REFUSED this caller — `key_invalid`, `package_mismatch`, `platform_mismatch`,
     * `cert_mismatch`, `sdk_version_missing`, `rate_limited`, `attestation_*`.
     *
     * Kept distinct from an empty success on purpose. The previous implementation caught every
     * exception and returned `emptyList()`, so a revoked key and "nothing to show" looked
     * identical to the integrator — the precise failure mode this product exists to remove.
     */
    data class Rejected(val code: String, val status: Int) : ConfigFetchResult

    /** Transport failure. The caller should keep serving its cache rather than showing nothing. */
    data class Unavailable(val cause: String) : ConfigFetchResult
}

/**
 * Talks to the rconfig control plane.
 *
 * Replaces the KmpToolkit 3.5.28 implementation, which built a Supabase client from a
 * consumer-supplied url + anon key and read the `product_remote_config` table over PostgREST.
 * That table is not what the control plane serves and never was, so the dashboard could not
 * reach any device.
 *
 * The [HttpClient] is INJECTED rather than constructed here: it keeps this module free of a
 * platform engine dependency on all fifteen targets, and makes the transport testable with
 * `MockEngine` instead of a live server.
 */
class RemoteConfigService(
    private val baseUrl: String,
    private val publishableKey: String,
    private val packageName: String,
    private val platform: String,
    private val appVersion: String,
    private val httpClient: HttpClient,
    /** Android only; the server compares it against the key's registered cert digests. */
    private val certDigest: String? = null,
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    /**
     * The value for `X-RC-SDK-Version`.
     *
     * Resolved defensively and cached: `cmpMetadata()` reaches into the external cmp-observe
     * artifact, and anything it throws — a class-version mismatch, a missing resource, an
     * initialisation order problem — would otherwise propagate out of EVERY fetch. A telemetry
     * helper must not be able to break config delivery, and the header must never be blank
     * because the server answers 403 sdk_version_missing rather than returning an empty set.
     */
    private val sdkVersion: String by lazy {
        try {
            cmpMetadata().version.takeIf { it.isNotBlank() && it != "UNKNOWN" } ?: FALLBACK_SDK_VERSION
        } catch (t: Throwable) {
            Logger.w(TAG) { "sdk version unavailable (${t::class.simpleName}); using fallback" }
            FALLBACK_SDK_VERSION
        }
    }

    /**
     * Fetch the configs this device should receive.
     *
     * `screen` scopes the request; null means "untargeted configs only", which is what the
     * server returns when the parameter is absent.
     */
    suspend fun fetchConfigs(screen: String?): ConfigFetchResult = try {
        val response: HttpResponse = httpClient.get("$baseUrl/v1-configs") {
            identityHeaders()
            if (screen != null) parameter("screen", screen)
        }
        if (response.status.isSuccess()) {
            ConfigFetchResult.Success(json.decodeFromString(response.bodyAsText()))
        } else {
            val code = response.errorCode()
            report("configs_rejected", mapOf("code" to code, "status" to response.status.value))
            ConfigFetchResult.Rejected(code, response.status.value)
        }
    } catch (e: Exception) {
        // Exception CLASS only, never the message: a transport error can echo the URL, and the
        // URL carries the publishable key's package context.
        Logger.e(TAG) { "config fetch failed: ${e::class.simpleName}" }
        report("configs_fetch_failed", mapOf("error" to (e::class.simpleName ?: "unknown")))
        ConfigFetchResult.Unavailable(e::class.simpleName ?: "unknown")
    }

    /**
     * Report impressions / dismissals / acks.
     *
     * Replaces the `get_device_impressions` RPC. The server dedupes on a client-supplied
     * `event_id`, so a retry of the same event is safe while a genuine second showing still
     * counts — which is why the caller must supply a stable id per event, not per config.
     */
    suspend fun recordEvents(deviceId: String, events: List<ConfigEvent>): Boolean = try {
        val body = buildEventBody(deviceId, events)
        val response: HttpResponse = httpClient.post("$baseUrl/v1-events") {
            identityHeaders()
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        response.status.isSuccess()
    } catch (e: Exception) {
        Logger.e(TAG) { "event report failed: ${e::class.simpleName}" }
        report("events_post_failed", mapOf("error" to (e::class.simpleName ?: "unknown")))
        false
    }

    private fun HttpRequestBuilder.identityHeaders() {
        header("X-RC-Key", publishableKey)
        header("X-RC-Package", packageName)
        header("X-RC-Platform", platform)
        header("X-RC-App-Version", appVersion)
        // Always sent. Without it every template's min_sdk_version check fails and the server
        // answers 403 sdk_version_missing rather than silently returning nothing.
        header("X-RC-SDK-Version", sdkVersion)
        certDigest?.let { header("X-RC-Cert", it) }
    }

    private suspend fun HttpResponse.errorCode(): String = try {
        json.parseToJsonElement(bodyAsText()).jsonObject["error"]?.jsonPrimitive?.content ?: "unknown"
    } catch (_: Exception) {
        "unknown"
    }

    private fun buildEventBody(deviceId: String, events: List<ConfigEvent>): String =
        json.encodeToString(EventBatch.serializer(), EventBatch(deviceId, events))

    private fun report(event: String, data: Map<String, Any?>) {
        Logger.i(TAG) { "$event ${data.entries.joinToString { "${it.key}=${it.value}" }}" }
    }

    private companion object {
        /** Used when the build did not stamp a version; still a real value so the header is never blank. */
        const val FALLBACK_SDK_VERSION = "5.0.0"
    }
}
