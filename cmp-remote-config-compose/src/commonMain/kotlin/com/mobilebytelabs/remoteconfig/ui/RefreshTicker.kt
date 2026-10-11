package com.mobilebytelabs.remoteconfig.ui

import kotlinx.coroutines.delay

/**
 * Decides when the next foreground refresh is due.
 *
 * ── Why this exists, and why it is a ticker rather than a clock ─────────────────────────────
 * The refresh loop was untestable. Its `delay(interval)` ran on the ViewModel's dispatcher, and
 * the two things a test needs pull in opposite directions: skipping a 60-second interval wants
 * a VIRTUAL clock, while the fetch underneath needs REAL time, because the HTTP call completes
 * on Ktor's own dispatcher and a virtual clock leaps past it — the same conflict that made
 * `withTimeoutOrNull` expire instantly under `runTest` and quietly turn every fetch into a
 * timeout.
 *
 * Injecting a *clock* would not resolve that: the loop does no time arithmetic to fake. It does
 * exactly one thing — wait until the next refresh is due — so that is what is injectable. A test
 * supplies a ticker it releases by hand, and gets a deterministic refresh in milliseconds with
 * no virtual clock anywhere near the fetch.
 *
 * The production implementation is one line, which is the point: nothing moved into the seam
 * except the waiting.
 */
public fun interface RefreshTicker {

    /**
     * Suspend until the next refresh should happen.
     *
     * @param intervalMs what the server asked for, already floored to
     *   `SdkSettings.MIN_FETCH_INTERVAL_SECONDS`. Passed rather than captured so an
     *   implementation can see the interval it is honouring — a test asserts on it, which is how
     *   "the server's interval is actually used" gets proven rather than assumed.
     */
    public suspend fun awaitTick(intervalMs: Long)

    public companion object {
        /** Plain `delay`. The default, and the only one production uses. */
        public val Default: RefreshTicker = RefreshTicker { delay(it) }
    }
}
