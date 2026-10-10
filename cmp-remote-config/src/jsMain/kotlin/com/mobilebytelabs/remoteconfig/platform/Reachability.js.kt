package com.mobilebytelabs.remoteconfig.platform

import kotlinx.browser.window

/**
 * `navigator.onLine`.
 *
 * False is reliable — the browser knows it has no interface. True means only "not definitely
 * offline", which is exactly what [Reachability.Reachable] claims and no more.
 */
actual fun currentReachability(): Reachability = runCatching {
    if (window.navigator.onLine) Reachability.Reachable else Reachability.Unreachable
    // No `window` at all — a worker or a non-browser host — is Unknown, not offline.
}.getOrDefault(Reachability.Unknown)

/**
 * Nothing to start: this platform's check is a synchronous read, answered on demand.
 */
public actual fun startReachabilityMonitoring() = Unit
