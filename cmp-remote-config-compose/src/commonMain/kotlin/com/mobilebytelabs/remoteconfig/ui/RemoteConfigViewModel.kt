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
    /**
     * Everything the server delivered this fetch, before device-side selection.
     *
     * Kept because selection is no longer a single app-wide answer: a `RemoteConfigHost` scoped
     * to a template list has to evaluate ITS subset, and it must do that through the same
     * evaluator rather than filtering `activeConfig` after the fact — which would show nothing
     * whenever the one app-wide winner happened to be a template that call site did not name.
     */
    val delivered: List<RemoteConfigItem> = emptyList(),
    /**
     * Configs dismissed or acted on during THIS session.
     *
     * A non-permanent dismissal writes nothing to the local store, so the evaluator cannot see
     * it. Before scoping that was invisible: dismissal just nulled `activeConfig` and nothing
     * re-ran the evaluator. Now that a scoped host re-evaluates, the same config would
     * immediately pass every check and reappear under the user's finger.
     */
    val suppressed: Set<String> = emptySet(),
)

class RemoteConfigViewModel(
    private val service: RemoteConfigService,
    private val evaluator: RemoteConfigEvaluator,
    private val localStore: RemoteConfigLocalStore,
    private val deviceIdProvider: DeviceIdProvider,
) : ViewModel() {

    private val _state = MutableStateFlow(RemoteConfigState())
    val state: StateFlow<RemoteConfigState> = _state.asStateFlow()

    /** Templates any host has asked for so far; the request is their union. */
    private var requested: Set<String> = emptySet()
    private var unscopedRequested = false
    private var fetched = false

    /** (owner, configId) of the host currently allowed to render. */
    private val _surfaceOwner = MutableStateFlow<Pair<Any, String>?>(null)
    val surfaceOwner: StateFlow<Pair<Any, String>?> = _surfaceOwner.asStateFlow()

    private val deviceId: String get() = deviceIdProvider.getDeviceId()

    /**
     * Fetch and pick the config to show.
     *
     * Audience targeting (platform, app-version window, screens, schedule) is evaluated
     * SERVER-side in 5.0.0, so no `appVersion` argument is threaded through any more — the
     * configs that arrive have already matched. The evaluator applies only what the device
     * knows: impression caps, dismissal, cooldown.
     */
    fun fetchAndEvaluate(screen: String? = null, templates: Set<String> = emptySet()) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, rejection = null) }

            // Hard timeout so a slow or blocked network cannot hang the host app's UI.
            // The scope bounds the REQUEST, not just the render: a screen that hosts two
            // templates has no use for the other thirteen, and shipping them anyway costs
            // payload and hands the client content it will only discard.
            val result = withTimeoutOrNull(FETCH_TIMEOUT_MS) { service.fetchConfigs(screen, templates) }

            when (result) {
                is ConfigFetchResult.Success -> {
                    val active = evaluator.evaluate(result.envelope.configs)
                    active?.let { localStore.cacheConfig(it) }
                    _state.update {
                        it.copy(
                            activeConfig = active,
                            delivered = result.envelope.configs,
                            isLoading = false,
                        )
                    }
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
                    val cached = localStore.getCachedConfig()
                    val cachedEligible = cached?.let { evaluator.evaluate(listOf(it)) }
                    _state.update {
                        it.copy(
                            activeConfig = cachedEligible ?: it.activeConfig,
                            // The cache holds the last-good config, not the last-good SET, so a
                            // scoped host offline sees at most this one. Better than nothing and
                            // honest about it: inventing a wider set would mean serving configs
                            // the evaluator never cached.
                            delivered = listOfNotNull(cached).ifEmpty { it.delivered },
                            isLoading = false,
                        )
                    }
                }
            }
        }
    }

    /**
     * The config to show for a call site that named a set of templates.
     *
     * Runs the SAME evaluator over a filtered list rather than filtering its answer: impression
     * caps, dismissal and cooldown stay in one place, and "show once" keeps meaning what it
     * means everywhere else. An empty set means "no scope" and behaves exactly as before.
     *
     * Pure with respect to the store — it reads, never writes — so a composable may call it
     * inside `remember`.
     */
    /**
     * Make sure the configs this call site needs have been asked for. Safe to call from every
     * host on every composition.
     *
     * ── Why the host fetches and the app does not ───────────────────────────────────────────
     * Setup is one Koin block; nothing else should be a step an integrator has to remember. An
     * app that forgot `fetchAndEvaluate()` showed no configs and produced no error — the whole
     * product silently doing nothing, which is the failure this one exists to remove.
     *
     * ── Why a UNION and not a fetch per host ────────────────────────────────────────────────
     * Several hosts can be composed at once, each naming different templates. One request for
     * the union of what they asked for beats one request each: the server answers the same set,
     * and a screen with three hosts does not make three round trips on every entry.
     *
     * Widening re-fetches; narrowing does not. A set we already hold is a superset of a
     * narrower request, so re-asking would spend a round trip to receive less.
     */
    fun ensureFetched(templateIds: Set<String>, screen: String? = null) {
        val widened = requested + templateIds
        // An unscoped host asks for everything, and "everything" can never be widened by a
        // later scoped host — so once one appears, stop narrowing the request forever.
        val wantsAll = unscopedRequested || templateIds.isEmpty()
        if (fetched && widened.size == requested.size && wantsAll == unscopedRequested) return

        requested = widened
        unscopedRequested = wantsAll
        fetched = true
        fetchAndEvaluate(screen, if (wantsAll) emptySet() else widened)
    }

    /**
     * Claim the right to be the one surface on screen.
     *
     * Two hosts on one screen each pick a winner independently, so both would render and the
     * user would get two overlays stacked on one another. Only the first claimant renders; the
     * rest wait until it is dismissed. "At most one interruption at a time" becomes a property
     * of the SDK rather than a convention each integrator has to keep.
     *
     * Keyed by the config id, not by the host: re-composing the same host for the same config
     * must not look like a second claimant.
     */
    fun claimSurface(owner: Any, configId: String): Boolean {
        val current = _surfaceOwner.value
        if (current == null || current.first === owner) {
            _surfaceOwner.value = owner to configId
            return true
        }
        return false
    }

    fun releaseSurface(owner: Any) {
        if (_surfaceOwner.value?.first === owner) _surfaceOwner.value = null
    }

    fun activeFor(templateIds: Set<String>): RemoteConfigItem? {
        val s = _state.value
        val candidates = s.delivered
            .filter { templateIds.isEmpty() || it.template in templateIds }
            .filterNot { it.id in s.suppressed }
        return evaluator.evaluate(candidates)
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
        _state.update { it.copy(activeConfig = null, suppressed = it.suppressed + configId) }
    }

    fun onActionClicked(configId: String) {
        val now = GMTDate().timestamp
        localStore.incrementImpressions(configId, now)
        report(configId, type = "action", at = now)
        _state.update { it.copy(activeConfig = null, suppressed = it.suppressed + configId) }
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
