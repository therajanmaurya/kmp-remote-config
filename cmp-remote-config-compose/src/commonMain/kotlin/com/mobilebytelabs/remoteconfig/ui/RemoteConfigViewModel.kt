package com.mobilebytelabs.remoteconfig.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.mobilebytelabs.remoteconfig.RemoteConfigEvaluator
import com.mobilebytelabs.remoteconfig.local.DeviceIdProvider
import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import co.touchlab.kermit.Logger
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import com.mobilebytelabs.remoteconfig.model.SdkSettings
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import io.github.mobilebytelabs.kmptoolkit.networkmonitor.NetworkMonitorProvider
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

    /**
     * The scope of every host CURRENTLY in composition, keyed by host.
     *
     * Mounted, not historical. An accumulating union only ever grows, so by the fifth screen of
     * a session the app is asking for everything again and the whole point of scoping is gone.
     * A host removes its entry when it leaves composition.
     *
     * LinkedHashMap (what `mutableMapOf` returns) because insertion order is the tie-break when
     * two candidates have equal priority — "whichever composed first" is at least stable.
     */
    private val mounted = mutableMapOf<Any, Set<String>>()

    /** The config each mounted host would show, if it were allowed to. */
    private val candidates = mutableMapOf<Any, RemoteConfigItem?>()

    /** What the last request asked for. `emptySet` means it asked for everything. */
    private var lastFetchedScope: Set<String>? = null

    /**
     * The server's SDK settings, as of the last successful fetch.
     *
     * Defaults until one lands, so the interval and the kill switch behave as the SDK's own
     * defaults rather than as "off" against a plane that has not answered yet.
     */
    private var settings: SdkSettings = SdkSettings()

    private var refreshJob: Job? = null

    /** The host allowed to render right now — the one offering the highest-priority config. */
    private val _surfaceOwner = MutableStateFlow<Any?>(null)
    val surfaceOwner: StateFlow<Any?> = _surfaceOwner.asStateFlow()

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
            // Two budgets, because the two cases are not the same risk.
            //
            // A REFRESH has something to show already — the delivered set, or the cached config
            // the unavailable branch falls back to — so being impatient costs the user nothing
            // they can see, and holding the loading state open is the worse trade.
            //
            // A FIRST fetch has nothing. Giving up at 2.5s there means the app shows bundled
            // defaults and no remote config at all, silently, and the SDK looks like it does
            // not work. Observed on a cold start that took 1m39s on a slow device: the budget
            // expired, the log said `configs_fetch_failed`, and a correctly configured app
            // served its defaults with nothing to say why.
            //
            // Waiting longer is close to free: the host renders nothing while loading either
            // way, so the only cost is WHEN the config appears, not whether the UI is blocked.
            val hasFallback = _state.value.delivered.isNotEmpty() || localStore.getCachedConfig() != null

            // Only a DEFINITE "no network" short-circuits. `Unknown` — every platform without a
            // cheap, reliable check — proceeds exactly as before, so no target regresses into
            // never fetching.
            //
            // This skips the WAIT, not the attempt-in-principle: without it an offline cold
            // start sits in `isLoading` for the full ten seconds waiting for an answer that
            // cannot arrive. A reachability check used to decide whether to try AT ALL is how
            // apps end up refusing to work on networks they would have been fine on, which is
            // why `Reachable` grants nothing and the fetch remains the real test.
            val budget = if (hasFallback) FETCH_TIMEOUT_MS else FIRST_FETCH_TIMEOUT_MS
            // `getOrNull` rather than `get`: an app that never called `remoteConfig { }` — or a
            // test that did not install one — has no monitor, and the absence of an answer must
            // read as "proceed", never as "offline". Only an explicit `false` short-circuits.
            val offline = NetworkMonitorProvider.getOrNull()?.currentStatus?.isOnline == false
            if (!hasFallback && offline) {
                // Logged, not silent. "No config appeared and nothing was even attempted" is
                // otherwise indistinguishable from a broken key or a misconfigured base URL,
                // and an integrator has no way to tell which from the outside.
                Logger.i(TAG) { "skipping first fetch: the platform reports no network" }
                _state.update { it.copy(isLoading = false) }
                return@launch
            }

            val result = withTimeoutOrNull(budget) { service.fetchConfigs(screen, templates) }

            when (result) {
                is ConfigFetchResult.Success -> {
                    val active = evaluator.evaluate(result.envelope.configs)
                    active?.let { localStore.cacheConfig(it) }
                    settings = result.envelope.settings

                    // The kill switch. `enabled = false` must stop what is already on screen,
                    // not merely stop the next fetch — a switch that leaves the current surface
                    // up until the user relaunches is half a switch, and the missing half is
                    // the one an operator reaches for during an incident.
                    val disabled = !result.envelope.settings.enabled
                    _state.update {
                        it.copy(
                            activeConfig = if (disabled) null else active,
                            delivered = if (disabled) emptyList() else result.envelope.configs,
                            isLoading = false,
                        )
                    }
                    if (disabled) {
                        candidates.clear()
                        recomputeSurfaceOwner()
                    }
                    restartRefreshLoop()
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
     * A host entered composition and wants these templates.
     *
     * Setup is one Koin block; nothing else should be a step an integrator has to remember. An
     * app that forgot `fetchAndEvaluate()` showed no configs and produced no error — the whole
     * product silently doing nothing, which is the failure this one exists to remove.
     */
    fun registerHost(owner: Any, templateIds: Set<String>) {
        val wasEmpty = mounted.isEmpty()
        mounted[owner] = templateIds
        reconcileFetch()
        // The first host on screen starts the clock; later ones join the loop already running.
        if (wasEmpty) restartRefreshLoop()
    }

    /**
     * A host left composition. Its templates stop counting toward the request and its candidate
     * stops competing for the surface.
     *
     * Deliberately does NOT re-fetch. What we hold is now a superset of what is wanted, and
     * re-asking would spend a round trip to receive less.
     */
    fun unregisterHost(owner: Any) {
        mounted.remove(owner)
        candidates.remove(owner)
        recomputeSurfaceOwner()
        // Nothing on screen: stop ticking rather than refresh for an audience of nobody.
        if (mounted.isEmpty()) refreshJob?.cancel()
    }

    /**
     * What this host would show. The highest-priority offer across all mounted hosts wins the
     * single surface.
     *
     * Priority rather than composition order: with two hosts on one screen, "whoever composed
     * first" means a forced update loses to an onboarding tip because of where someone put a
     * call in a file. Priority is the operator's expressed intent and it should decide.
     */
    fun offerCandidate(owner: Any, config: RemoteConfigItem?) {
        if (candidates[owner]?.id == config?.id && candidates.containsKey(owner)) return
        candidates[owner] = config
        recomputeSurfaceOwner()
    }

    /**
     * Re-fetch on the interval the server asked for, while a host is on screen.
     *
     * `fetch_interval_seconds` was parsed and `RemoteConfigClient.shouldFetch` implemented the
     * arithmetic, and nothing called either outside tests — so an operator could set a fifteen
     * minute refresh, publish, and watch a running app never notice. The kill switch had the
     * same hole: `enabled = false` only took effect on a cold start.
     *
     * Tied to MOUNTED hosts rather than to a lifecycle callback: host presence is the one
     * signal available on every target, and it means the loop cannot tick for an app that is
     * displaying nothing. It does NOT pause when the app is backgrounded with a host still
     * composed — a real limit, and part of why the floor below is a minute rather than a second.
     */
    private fun restartRefreshLoop() {
        refreshJob?.cancel()
        if (mounted.isEmpty() || !settings.enabled) return

        // The server's floor, not ours to undercut: MIN_FETCH_INTERVAL_SECONDS exists so a
        // misconfigured app cannot hammer the control plane.
        val seconds = maxOf(settings.fetchIntervalSeconds, SdkSettings.MIN_FETCH_INTERVAL_SECONDS)
        refreshJob = viewModelScope.launch {
            while (isActive) {
                delay(seconds * 1000L)
                if (mounted.isEmpty()) break
                // The union currently on screen, not the scope of the original fetch: the user
                // may have navigated since, and refreshing what they left is wasted payload.
                fetchAndEvaluate(templates = lastFetchedScope ?: emptySet())
            }
        }
    }

    private fun recomputeSurfaceOwner() {
        // maxByOrNull keeps the FIRST maximum, so equal priorities fall back to insertion
        // order — stable, which is the most that can be promised when nothing distinguishes
        // them.
        _surfaceOwner.value = candidates.entries
            .filter { it.value != null }
            .maxByOrNull { it.value!!.priority }
            ?.key
    }

    /**
     * Fetch if what we hold cannot answer what the mounted hosts are asking for.
     *
     * The request is the union of the CURRENTLY mounted scopes. An unscoped host wants
     * everything, and once one is mounted no narrowing is possible while it stays.
     */
    private fun reconcileFetch() {
        val scopes = mounted.values
        val wantsAll = scopes.any { it.isEmpty() }
        val union = if (wantsAll) emptySet() else scopes.flatten().toSet()

        val held = lastFetchedScope
        val covered = when {
            held == null -> false              // nothing fetched yet
            held.isEmpty() -> true             // we asked for everything; any subset is covered
            wantsAll -> false                  // we hold a subset but someone wants everything
            else -> held.containsAll(union)
        }
        if (covered) return

        lastFetchedScope = union
        fetchAndEvaluate(templates = union)
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
        const val TAG = "RemoteConfigViewModel"

        /** Refresh budget: there is already something on screen, so do not hold the state open. */
        const val FETCH_TIMEOUT_MS = 2500L

        /**
         * First-fetch budget, when there is nothing cached to fall back on.
         *
         * Ten seconds is long for a UI timeout and deliberately so — nothing is blocked on it.
         * The alternative is an app that silently serves bundled defaults on every slow cold
         * start, which reads as "the SDK does not work" rather than "the network was slow".
         */
        const val FIRST_FETCH_TIMEOUT_MS = 10_000L
    }
}

/** Minimal ISO-8601 UTC, avoiding a kotlinx-datetime dependency for one formatter. */
private fun io.ktor.util.date.GMTDate.toIsoString(): String {
    fun p(n: Int, w: Int = 2) = n.toString().padStart(w, '0')
    return "${p(year, 4)}-${p(month.ordinal + 1)}-${p(dayOfMonth)}T${p(hours)}:${p(minutes)}:${p(seconds)}Z"
}
