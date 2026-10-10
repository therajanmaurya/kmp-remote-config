package com.mobilebytelabs.remoteconfig.platform

/**
 * Not implemented here, deliberately — and that is the honest answer rather than a gap.
 *
 * [Reachability.Unknown] behaves exactly as this SDK did before reachability existed: the fetch
 * is attempted and its timeout decides. Nothing on this platform regresses.
 *
 * Apple has `NWPathMonitor`, but it is asynchronous and awkward to drive from Kotlin/Native,
 * and a subtly wrong implementation is worse than none: it would skip fetches that should have
 * happened, on a platform where the user has no way to tell why their app shows stale content.
 * Desktop and the native targets have no cheap, dependency-free answer at all.
 */
actual fun currentReachability(): Reachability = Reachability.Unknown

/**
 * Nothing to start: this platform's check is a synchronous read, answered on demand.
 */
public actual fun startReachabilityMonitoring() = Unit
