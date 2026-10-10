package com.mobilebytelabs.remoteconfig.platform

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Network.nw_path_get_status
import platform.Network.nw_path_monitor_create
import platform.Network.nw_path_monitor_set_queue
import platform.Network.nw_path_monitor_set_update_handler
import platform.Network.nw_path_monitor_start
import platform.Network.nw_path_status_satisfied
import platform.darwin.dispatch_queue_create
import kotlin.concurrent.AtomicReference

/**
 * `NWPathMonitor`, running continuously and read synchronously.
 *
 * ── Why a long-lived monitor and not a probe ────────────────────────────────────────────────
 * The Network framework offers no synchronous "are we online" call. `NWPathMonitor` delivers the
 * current path through a callback shortly after it starts, then again on every change. So the
 * monitor runs from DI setup and this file caches what it last said; [currentReachability] is a
 * read of that cache and never blocks.
 *
 * The consequence, stated rather than hidden: before the first callback arrives the answer is
 * [Reachability.Unknown], which proceeds with the fetch exactly as a platform with no
 * implementation would. That is why [startReachabilityMonitoring] is called at DI setup rather
 * than lazily on first use — by first fetch the callback has long since landed.
 *
 * ── Why the default is Unknown and not Reachable ────────────────────────────────────────────
 * Both are "proceed", but they mean different things to a reader, and only one of them stays
 * true if the short-circuit rule is ever widened to treat non-Reachable as a reason not to
 * fetch. Unknown is the honest state for "the monitor has not reported yet".
 */
@OptIn(ExperimentalForeignApi::class)
private val latest = AtomicReference(Reachability.Unknown)

@OptIn(ExperimentalForeignApi::class)
private val started = AtomicReference(false)

@OptIn(ExperimentalForeignApi::class)
public actual fun startReachabilityMonitoring() {
    // compareAndSet, not a bare flag: two threads reaching DI setup together would otherwise
    // each create a monitor, and a leaked one keeps a dispatch queue alive for the process.
    if (!started.compareAndSet(false, true)) return

    runCatching {
        val monitor = nw_path_monitor_create()
        nw_path_monitor_set_update_handler(monitor) { path ->
            // `satisfied` is the only status that means a request can be attempted.
            // `unsatisfied`, `requiresConnection` and anything added later are all "not now".
            latest.value =
                if (path != null && nw_path_get_status(path) == nw_path_status_satisfied) {
                    Reachability.Reachable
                } else {
                    Reachability.Unreachable
                }
        }
        // A dedicated serial queue. Handing it a global concurrent queue would let two path
        // updates race and leave the cache holding the older one.
        // `null` attr is a SERIAL queue, which is what this needs: a concurrent one would let
        // two path updates race and leave the cache holding the older of the two.
        nw_path_monitor_set_queue(
            monitor,
            dispatch_queue_create("io.github.mobilebytelabs.remoteconfig.reachability", null),
        )
        nw_path_monitor_start(monitor)
        // Deliberately never cancelled: it lives for the process, like the SDK itself. Holding
        // it in a top-level val keeps it from being collected while the queue still references
        // it, which on Apple is how a monitor silently stops reporting.
        keepAlive.value = monitor
    }.onFailure {
        // A monitor that cannot start must not stop fetches. Back to Unknown — proceed.
        latest.value = Reachability.Unknown
    }
}

@OptIn(ExperimentalForeignApi::class)
private val keepAlive = AtomicReference<Any?>(null)

@OptIn(ExperimentalForeignApi::class)
public actual fun currentReachability(): Reachability = latest.value
