package com.mobilebytelabs.remoteconfig.platform

/**
 * `navigator.onLine`, read through a JS interop function.
 *
 * `kotlinx.browser` is not on this module's wasmJs classpath — the module ships no browser
 * dependency — so the value is read directly rather than adding one for a single boolean.
 *
 * False is reliable: the browser knows it has no interface. True means only "not definitely
 * offline", which is exactly what [Reachability.Reachable] claims and no more.
 */
private fun navigatorOnLine(): Boolean = js("(typeof navigator !== 'undefined') ? navigator.onLine : true")

actual fun currentReachability(): Reachability = runCatching {
    if (navigatorOnLine()) Reachability.Reachable else Reachability.Unreachable
    // No `navigator` at all — a worker or a non-browser host — is Unknown, never offline.
}.getOrDefault(Reachability.Unknown)
