package com.mobilebytelabs.remoteconfig.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * SDK behaviour an operator controls without shipping an app release.
 *
 * Every field is defaulted so an older server that sends no `settings` block keeps working —
 * and critically, [enabled] defaults TRUE. An absent settings block must never read as
 * "disabled": that would black out every integration pointed at a plane that predates this
 * feature.
 */
@Serializable
data class SdkSettings(
    /**
     * The kill switch. Honoured from CACHE on the offline path — a switch a client can only
     * learn from a successful fetch fails in the exact situation it exists for.
     */
    val enabled: Boolean = true,
    @SerialName("fetch_interval_seconds") val fetchIntervalSeconds: Int = DEFAULT_FETCH_INTERVAL_SECONDS,
    @SerialName("cache_ttl_seconds") val cacheTtlSeconds: Int = 86_400,
    @SerialName("max_retries") val maxRetries: Int = 3,
    @SerialName("backoff_base_seconds") val backoffBaseSeconds: Int = 2,
) {
    companion object {
        const val DEFAULT_FETCH_INTERVAL_SECONDS: Int = 3_600

        /**
         * The floor the client enforces regardless of what a server asks for.
         *
         * Database CHECK bounds stop an operator typing 1 second, but this SDK also talks to
         * self-hosted planes and to rows written before those bounds existed. A compiled-in
         * floor cannot be withdrawn by the thing it protects against — and an interval the
         * server sets cannot be retracted faster than the interval itself.
         */
        const val MIN_FETCH_INTERVAL_SECONDS: Int = 60
    }
}
