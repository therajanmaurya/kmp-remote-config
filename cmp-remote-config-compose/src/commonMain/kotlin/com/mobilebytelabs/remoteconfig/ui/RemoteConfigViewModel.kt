package com.mobilebytelabs.remoteconfig.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mobilebytelabs.remoteconfig.RemoteConfigEvaluator
import com.mobilebytelabs.remoteconfig.local.DeviceIdProvider
import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import com.mobilebytelabs.remoteconfig.network.ConfigEvent
import com.mobilebytelabs.remoteconfig.network.ConfigFetchResult
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import io.ktor.util.date.GMTDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * @param rejection set when the SERVER refused this caller (`key_invalid`, `package_mismatch`,
 *   `rate_limited`, …). Surfaced rather than swallowed so an integrator with a dead key
 *   learns that instead of watching their product show nothing — the defect this product
 *   exists to remove.
 */
data class RemoteConfigState(
    val activeConfig: RemoteConfigItem? = null,
    val isLoading: Boolean = true,
    val rejection: String? = null,
)

class RemoteConfigViewModel(
    private val service: RemoteConfigService,
    private val evaluator: RemoteConfigEvaluator,
    private val localStore: RemoteConfigLocalStore,
    private val deviceIdProvider: DeviceIdProvider,
) : ViewModel() {

    private val _state = MutableStateFlow(RemoteConfigState())
    val state: StateFlow<RemoteConfigState> = _state.asStateFlow()

    private val deviceId: String get() = deviceIdProvider.getDeviceId()

    /**
     * Fetch and pick the config to show.
     *
     * Audience targeting (platform, app-version window, screens, schedule) is evaluated
     * SERVER-side in 5.0.0, so no `appVersion` argument is threaded through any more — the
     * configs that arrive have already matched. The evaluator applies only what the device
     * knows: impression caps, dismissal, cooldown.
     */
    fun fetchAndEvaluate(screen: String? = null) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, rejection = null) }

            // Hard timeout so a slow or blocked network cannot hang the host app's UI.
            val result = withTimeoutOrNull(FETCH_TIMEOUT_MS) { service.fetchConfigs(screen) }

            when (result) {
                is ConfigFetchResult.Success -> {
                    val active = evaluator.evaluate(result.envelope.configs)
                    active?.let { localStore.cacheConfig(it) }
                    _state.update { it.copy(activeConfig = active, isLoading = false) }
                }

                is ConfigFetchResult.Rejected -> {
                    // A refusal is NOT an empty config set. Show nothing, but say why — a
                    // revoked key and "no configs" must never look the same.
                    _state.update {
                        it.copy(activeConfig = null, isLoading = false, rejection = result.code)
                    }
                }

                // Transport failure or timeout: fall back to the last-good cached config, but
                // ONLY if it still passes the same device-side rules. The cache is a network
                // fallback, never a bypass of a cooldown or an impression cap.
                is ConfigFetchResult.Unavailable, null -> {
                    val cachedEligible = localStore.getCachedConfig()
                        ?.let { evaluator.evaluate(listOf(it)) }
                    _state.update {
                        it.copy(
                            activeConfig = cachedEligible ?: it.activeConfig,
                            isLoading = false,
                        )
                    }
                }
            }
        }
    }

    fun onConfigShown(configId: String) {
        val now = GMTDate().timestamp
        localStore.incrementImpressions(configId, now)
        report(configId, type = "impression", at = now)
    }

    fun onConfigDismissed(configId: String, permanent: Boolean = false) {
        if (permanent) {
            localStore.markDismissed(configId)
            report(configId, type = "dismiss", at = GMTDate().timestamp)
        }
        _state.update { it.copy(activeConfig = null) }
    }

    fun onActionClicked(configId: String) {
        val now = GMTDate().timestamp
        localStore.incrementImpressions(configId, now)
        report(configId, type = "action", at = now)
        _state.update { it.copy(activeConfig = null) }
    }

    /**
     * Fire-and-forget event report.
     *
     * `event_id` is unique PER EVENT (config + type + timestamp), not per config. The server
     * dedupes on it, so a network retry of one impression is ignored while a genuine second
     * showing still counts — deduping per config instead would silently cap every config at
     * one impression forever.
     */
    private fun report(configId: String, type: String, at: Long) {
        viewModelScope.launch {
            service.recordEvents(
                deviceId = deviceId,
                events = listOf(
                    ConfigEvent(
                        eventId = "$configId-$type-$at",
                        configId = configId,
                        type = type,
                        at = GMTDate().toIsoString(),
                    ),
                ),
            )
        }
    }

    private companion object {
        const val FETCH_TIMEOUT_MS = 2500L
    }
}

/** Minimal ISO-8601 UTC, avoiding a kotlinx-datetime dependency for one formatter. */
private fun io.ktor.util.date.GMTDate.toIsoString(): String {
    fun p(n: Int, w: Int = 2) = n.toString().padStart(w, '0')
    return "${p(year, 4)}-${p(month.ordinal + 1)}-${p(dayOfMonth)}T${p(hours)}:${p(minutes)}:${p(seconds)}Z"
}
