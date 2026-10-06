package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import com.mobilebytelabs.remoteconfig.model.DeviceImpression
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import io.ktor.util.date.GMTDate

/**
 * Decides which delivered config to show, and whether to show one at all.
 *
 * **This evaluator got smaller in 5.0.0, deliberately.** It used to apply `is_enabled`, the
 * schedule window, the app-version window and the platform filter on-device. The control
 * plane now evaluates every one of those server-side, so a config that arrives has ALREADY
 * matched this audience — re-checking them here would mean two implementations of the same
 * rules drifting apart, and the client's copy losing (it cannot see screens, cohorts or
 * rollout buckets at all).
 *
 * What remains is what only the device knows: how many times this install has seen a config,
 * whether the user dismissed it, and whether its cooldown has elapsed.
 */
class RemoteConfigEvaluator(
    private val localStore: RemoteConfigLocalStore,
) {
    fun evaluate(
        configs: List<RemoteConfigItem>,
        serverImpressions: Map<String, DeviceImpression> = emptyMap(),
        currentTimeMs: Long = GMTDate().timestamp,
    ): RemoteConfigItem? = configs
        // A value-only config (feature_flag, display "none") is read through the typed
        // getters, never rendered. Letting one win here would show an empty overlay.
        .filter { it.rendersUi }
        .filter { passesImpressionLimit(it, serverImpressions) }
        .filter { !isDismissed(it, serverImpressions) }
        .filter { passesCooldown(it, currentTimeMs) }
        .sortedByDescending { it.priority }
        .firstOrNull()

    /**
     * `max_impressions = 0` means unlimited; any positive value is a hard cap.
     *
     * Local and server counts are combined with `max` rather than summed: the server count
     * survives a reinstall while the local one survives offline use, and the same showing is
     * frequently recorded in both. Summing would double-count it and silently halve every cap.
     */
    private fun passesImpressionLimit(
        config: RemoteConfigItem,
        serverImpressions: Map<String, DeviceImpression>,
    ): Boolean {
        if (config.maxImpressions <= 0) return true
        val local = localStore.getImpressions(config.id)
        val server = serverImpressions[config.id]?.impressions ?: 0
        return maxOf(local, server) < config.maxImpressions
    }

    /** Dismissal is sticky across devices: either side having recorded it is enough. */
    private fun isDismissed(
        config: RemoteConfigItem,
        serverImpressions: Map<String, DeviceImpression>,
    ): Boolean = localStore.isDismissed(config.id) || (serverImpressions[config.id]?.dismissed == true)

    private fun passesCooldown(config: RemoteConfigItem, currentTimeMs: Long): Boolean {
        if (config.cooldownHours <= 0) return true
        val last = localStore.getLastShownMs(config.id)
        if (last <= 0L) return true  // never shown
        return currentTimeMs - last >= config.cooldownHours * MS_PER_HOUR
    }

    private companion object {
        const val MS_PER_HOUR = 60L * 60L * 1000L
    }
}
