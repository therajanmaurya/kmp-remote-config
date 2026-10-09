package com.mobilebytesensei.rconfig

import com.mobilebytelabs.remoteconfig.RemoteConfigClient
import com.mobilebytelabs.remoteconfig.RemoteConfigEvaluator
import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import com.mobilebytelabs.remoteconfig.network.ConfigFetchResult
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import com.mobilebytelabs.remoteconfig.platform.PlatformIdentity
import com.mobilebytelabs.remoteconfig.remoteConfigDefaults
import io.ktor.client.HttpClient

/**
 * The integration the dashboard's onboarding step tells an operator to write — compiled, so
 * the documented path is one that has actually been built rather than one that merely reads
 * correctly.
 *
 * `com.mobilebytesensei.rconfig` is the application id this sample registers under. Kotlin
 * Multiplatform shares ONE id across every target, so the same string is what `packageName`
 * carries on Android, iOS, desktop and web — which is why the onboarding wizard defaults to a
 * single shared id rather than asking five times.
 */
object SampleConfig {

    /** The id every target reports. One value, because this is a KMP app. */
    const val APPLICATION_ID: String = "com.mobilebytesensei.rconfig"

    /**
     * Bundled defaults, served before any fetch has landed.
     *
     * These are not a nicety. On a first launch with no network there is no server value for
     * anything, and without them every flag-gated feature would be silently off for every new
     * install until a fetch succeeded.
     */
    val defaults = remoteConfigDefaults {
        boolean("welcome_banner_enabled", false)
        long("max_upload_mb", 50)
        string("checkout_copy", "Proceed to checkout")
    }

    /**
     * Build the reading surface.
     *
     * The [HttpClient] is INJECTED rather than constructed here: the SDK ships no platform
     * engine across fifteen targets, and an app that already tuned a client — timeouts, proxy,
     * certificate pinning — keeps using it.
     *
     * @param publishableKey the TEST key for a debug build. It skips attestation, because Play
     *   Integrity rejects debug and sideloaded builds and a developer could otherwise never run
     *   their own app. Ship the live key in a release build.
     */
    fun client(
        publishableKey: String,
        platform: String,
        appVersion: String,
        httpClient: HttpClient,
        deviceId: String?,
    ): SampleRemoteConfig {
        val service = RemoteConfigService(
            baseUrl = DEFAULT_BASE_URL,
            publishableKey = publishableKey,
            packageName = APPLICATION_ID,
            platform = platform,
            appVersion = appVersion,
            httpClient = httpClient,
            // Bucketing input for a staged rollout. Null is honest: the server EXCLUDES an
            // unidentified caller from a partial rollout rather than including it, so a
            // missing id makes a rollout reach fewer devices, never more.
            deviceId = deviceId,
            // Resolved by the SDK. This used to be a parameter the host had to supply, and the
            // sample proves why it should not be: it builds TWO services — this one backs the
            // typed getters and the Fetch button, the Koin one backs RemoteConfigHost — so a
            // caller-supplied digest was two places to forget, and forgetting either served
            // bundled defaults forever while looking healthy.
            certDigest = PlatformIdentity.signingDigest,
        )
        val store = RemoteConfigLocalStore()
        return SampleRemoteConfig(
            service = service,
            evaluator = RemoteConfigEvaluator(store),
            values = RemoteConfigClient(defaults = defaults),
        )
    }

    /** The hosted control plane. Overridden only when self-hosting. */
    private const val DEFAULT_BASE_URL = "https://gohifhjcvsawcdhcpbkw.supabase.co/functions/v1"
}

/**
 * What a host app holds: typed value reads, plus whichever UI config should be shown.
 *
 * The two are separate because they answer different questions — `values` is read wherever a
 * flag is needed, while `activeConfig` is handed to `RemoteConfigHost` to render.
 */
class SampleRemoteConfig internal constructor(
    private val service: RemoteConfigService,
    private val evaluator: RemoteConfigEvaluator,
    val values: RemoteConfigClient,
) {
    var activeConfig: RemoteConfigItem? = null
        private set

    /**
     * EVERY config the server delivered, not just the one the evaluator chose.
     *
     * `activeConfig` answers "what should this user see right now" — one item, after impression
     * caps, dismissal and cooldown. That is the right answer for delivery and the wrong one for
     * a gallery: the sample exists to show what each template looks like, and dropping thirteen
     * of fourteen on the floor would make most of the product invisible.
     *
     * Kept in delivery order so the list is stable between launches; the server sorts by
     * priority, and reordering here would make the gallery shuffle for no reason.
     */
    var deliveredConfigs: List<RemoteConfigItem> = emptyList()
        private set

    var lastRejection: String? = null
        private set

    /**
     * Fetch and apply.
     *
     * Returns false on a refusal so the caller can SEE it. The 3.5.28 SDK caught every
     * exception and returned an empty list, which made a revoked key and "nothing to show"
     * indistinguishable — the precise defect this product exists to remove, so the sample
     * must not reintroduce it by swallowing the result.
     */
    suspend fun refresh(screen: String? = null): Boolean {
        return when (val result = service.fetchConfigs(screen)) {
            is ConfigFetchResult.Success -> {
                values.accept(result.envelope)
                deliveredConfigs = result.envelope.configs
                activeConfig = evaluator.evaluate(result.envelope.configs)
                lastRejection = null
                true
            }

            is ConfigFetchResult.Rejected -> {
                // key_invalid, package_mismatch, cert_mismatch, rate_limited…
                lastRejection = result.code
                false
            }

            // Transport failure: keep serving whatever the client already holds.
            is ConfigFetchResult.Unavailable -> false
        }
    }
}
