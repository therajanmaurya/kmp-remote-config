package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.platform.Reachability
import com.mobilebytelabs.remoteconfig.platform.currentReachability
import com.mobilebytelabs.remoteconfig.platform.startReachabilityMonitoring
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The Apple monitor actually reports.
 *
 * This is the assertion that matters for `NWPathMonitor`, and the one that cannot be made in
 * `commonTest`: everywhere else `Unknown` is the correct permanent answer, so a shared test
 * could only check the enum is well-formed. Here `Unknown` after the monitor has run means the
 * callback never fired — the plumbing is wrong — and the feature silently does nothing while
 * looking implemented.
 *
 * Deliberately asserts NOT-Unknown rather than Reachable. Which of the two real states is
 * correct depends on whether the machine running the suite has a network, and a test that
 * demanded `Reachable` would fail on an offline build box for the wrong reason.
 */
class ReachabilityAppleTest {

    @Test
    fun the_monitor_reports_a_real_state_within_a_second() = runBlocking {
        startReachabilityMonitoring()

        // Polled rather than slept-once: the callback is typically immediate, and waiting a
        // fixed second would make every run pay for the worst case.
        var seen = currentReachability()
        repeat(40) {
            if (seen != Reachability.Unknown) return@repeat
            delay(25)
            seen = currentReachability()
        }

        assertTrue(
            seen != Reachability.Unknown,
            "NWPathMonitor never reported — currentReachability() would answer Unknown forever, " +
                "and the check would silently do nothing on every Apple target",
        )
    }

    @Test
    fun repeated_starts_do_not_disturb_a_running_monitor() {
        startReachabilityMonitoring()
        val first = currentReachability()
        repeat(5) { startReachabilityMonitoring() }
        assertTrue(currentReachability() == first, "a second start replaced or reset the monitor")
    }
}
