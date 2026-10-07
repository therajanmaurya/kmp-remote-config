package com.mobilebytesensei.rconfig.headless

import com.mobilebytelabs.remoteconfig.RemoteConfigClient
import com.mobilebytelabs.remoteconfig.model.SdkSettings
import com.mobilebytelabs.remoteconfig.network.ConfigFetchResult
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import com.mobilebytelabs.remoteconfig.remoteConfigDefaults
import io.ktor.client.HttpClient

/**
 * Reading remote config with **no Compose anywhere** — a server, a CLI, a watch complication.
 *
 * This file imports only from `com.mobilebytelabs.remoteconfig.*` (the headless artefact). Its
 * module applies neither Compose plugin and declares targets Compose Multiplatform does not
 * publish for, so the compiler enforces what this comment claims: if the core ever acquired a
 * Compose dependency, this would stop building.
 *
 * That is the reason the library is two artefacts rather than one module with a Compose source
 * set. The Compose compiler plugin applies to EVERY compilation in a module and fails on any
 * target without the Compose runtime on the class path — so a single module would mean a
 * backend could not evaluate a config at all.
 */
class HeadlessConfig(
    publishableKey: String,
    platform: String,
    appVersion: String,
    httpClient: HttpClient,
    deviceId: String? = null,
) {
    private val service = RemoteConfigService(
        baseUrl = BASE_URL,
        publishableKey = publishableKey,
        packageName = APPLICATION_ID,
        platform = platform,
        appVersion = appVersion,
        httpClient = httpClient,
        deviceId = deviceId,
    )

    /**
     * Values only. No evaluator and no local store: both exist to decide which SURFACE to show
     * and to apply impression caps — questions a backend does not ask. A config with
     * `renders_ui = false` is exactly what this consumer wants, and it arrives through the
     * typed getters without any of that machinery.
     */
    private val client = RemoteConfigClient(
        defaults = remoteConfigDefaults {
            boolean("maintenance_mode", false)
            long("rate_limit_per_minute", 60)
            string("feature_tier", "standard")
        },
    )

    /** Last known settings, restored from wherever this host persists them. */
    fun restoreSettings(cached: SdkSettings) = client.acceptSettings(cached)

    /**
     * Whether to fetch now, honouring the operator's interval AND the kill switch.
     *
     * A backend polling in a loop is the case the switch matters most for: it is the thing an
     * operator reaches for when a fleet is hammering a struggling service, and it is honoured
     * from cache so it works even when the fetch that would deliver it cannot complete.
     */
    fun shouldFetch(lastFetchAtMs: Long?, nowMs: Long): Boolean = client.shouldFetch(lastFetchAtMs, nowMs)

    /**
     * @return null on success, or the server's refusal code.
     *
     * The code is RETURNED rather than logged and discarded: `key_invalid` and "nothing
     * configured" must never look the same to an operator reading a log, which is the precise
     * failure the 5.0.0 transport rewrite removed.
     */
    suspend fun refresh(): String? = when (val result = service.fetchConfigs(screen = null)) {
        is ConfigFetchResult.Success -> {
            client.accept(result.envelope)
            null
        }
        is ConfigFetchResult.Rejected -> result.code
        is ConfigFetchResult.Unavailable -> result.cause
    }

    val maintenanceMode: Boolean get() = client.getBoolean("maintenance_mode") ?: false
    val rateLimitPerMinute: Long get() = client.getLong("rate_limit_per_minute") ?: 60
    val featureTier: String get() = client.getString("feature_tier") ?: "standard"

    private companion object {
        const val APPLICATION_ID = "com.mobilebytesensei.rconfig"
        const val BASE_URL = "https://gohifhjcvsawcdhcpbkw.supabase.co/functions/v1"
    }
}
