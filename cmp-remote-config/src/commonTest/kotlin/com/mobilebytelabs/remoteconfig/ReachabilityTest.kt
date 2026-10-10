package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.platform.Reachability
import com.mobilebytelabs.remoteconfig.platform.currentReachability
import com.mobilebytelabs.remoteconfig.platform.startReachabilityMonitoring
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Reachability is a hint, and the shape of the type is what keeps it one.
 *
 * These do not assert WHICH value a platform returns — that depends on the machine running the
 * suite, and a test that demanded `Reachable` would fail on an offline CI box while proving
 * nothing. What they pin is that the check is safe to call and cannot throw, because it runs on
 * the path to every first fetch: a reachability probe that crashes would take out the feature
 * it exists to protect.
 */
class ReachabilityTest {

    @Test
    fun the_check_answers_without_throwing() {
        // Each actual wraps its platform call in runCatching for exactly this reason — a
        // SecurityException from a stripped permission, or a missing service, must degrade to
        // Unknown rather than propagate into the fetch.
        val r = currentReachability()
        assertTrue(r in Reachability.entries, "unexpected value: $r")
    }

    @Test
    fun repeated_checks_are_consistent_and_cheap() {
        // Called before every first fetch, so it has to be cheap and stable rather than
        // probing the network itself.
        val first = currentReachability()
        repeat(50) { assertTrue(currentReachability() == first) }
    }

    @Test
    fun unknown_is_a_real_state_and_not_a_synonym_for_offline() {
        // The whole safety property: only Unreachable changes behaviour. If Unknown were ever
        // folded into "offline", every platform without an implementation — Apple, desktop,
        // the native targets — would stop fetching entirely, which is a far worse failure than
        // the ten-second wait this was meant to avoid.
        assertTrue(Reachability.Unknown != Reachability.Unreachable)
        assertTrue(Reachability.entries.size == 3)
    }

    @Test
    fun starting_the_monitor_is_idempotent_and_does_not_throw() {
        // Called from `Module.remoteConfig { }`, which an app may configure more than once in a
        // process — tests, a multi-module app, a Koin reload. On Apple each call would
        // otherwise create another NWPathMonitor and leak the dispatch queue holding it, so the
        // guard there is a compareAndSet rather than a bare flag.
        repeat(5) { startReachabilityMonitoring() }
        assertTrue(currentReachability() in Reachability.entries)
    }
}
