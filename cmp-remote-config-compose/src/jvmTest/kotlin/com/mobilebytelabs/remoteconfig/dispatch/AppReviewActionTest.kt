package com.mobilebytelabs.remoteconfig.dispatch

import com.mobilebytelabs.kmptoolkit.appreview.AppReview
import com.mobilebytelabs.kmptoolkit.appreview.AppReviewCapabilities
import com.mobilebytelabs.kmptoolkit.appreview.testing.FakeAppReviewManager
import com.mobilebytelabs.kmptoolkit.openurl.testing.FakeUrlLauncher
import com.mobilebytelabs.remoteconfig.model.ActionType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `rating_prompt` asks for a review in place, instead of throwing the user at a store listing.
 *
 * The template's own copy used to say "a rating prompt sends to the store rather than collecting
 * a score in-app" — phrased as a design choice when it was really a description of the limit.
 * Both platforms ship a review sheet that appears OVER the app, which is the entire reason they
 * exist and why a store link converts so much worse.
 *
 * Testable at all because `cmp-app-review` ships `FakeAppReviewManager` with call counters. The
 * hand-rolled equivalent would have needed a simulator and a human to watch it.
 */
class AppReviewActionTest {

    @AfterTest
    fun tearDown() {
        ActionDispatcher.clear()
        ActionDispatcher.resetLauncher()
        ActionDispatcher.resetScope()
        AppReview.reset()
        Dispatchers.resetMain()
    }

    /**
     * An extension on TestScope so the dispatcher shares `runTest`'s scheduler.
     *
     * A plain `StandardTestDispatcher()` carries its OWN scheduler, and `advanceUntilIdle()`
     * then advances a clock nothing is waiting on — the launched work never runs and every
     * assertion fails against correct code, which is exactly how this file failed first time.
     */
    private fun TestScope.arrange(native: Boolean): Pair<FakeAppReviewManager, FakeUrlLauncher> {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        ActionDispatcher.setScopeForTest(TestScope(dispatcher))

        val fake = FakeAppReviewManager(
            capabilities = AppReviewCapabilities(nativeInAppReview = native, storeListing = true),
        )
        AppReview.configure(fake)

        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)
        return fake to launcher
    }

    @Test
    fun a_review_action_asks_for_the_native_sheet() = runTest {
        val (review, launcher) = arrange(native = true)

        ActionDispatcher.dispatch(ActionType.REVIEW, "https://play.google.com/store/apps/details?id=x")
        advanceUntilIdle()

        assertEquals(1, review.requestCount, "the native review sheet was never requested")
        assertEquals(
            0, launcher.opened.size,
            "the listing was opened as well — the user would be thrown out of the app by the " +
                "very action meant to keep them in it",
        )
    }

    @Test
    fun a_platform_with_no_review_api_falls_back_to_the_listing() = runTest {
        // Desktop and web have no review sheet. Doing nothing there would make the button dead,
        // which is worse than sending them to the listing.
        val (_, launcher) = arrange(native = false)

        ActionDispatcher.dispatch(ActionType.REVIEW, "https://example.test/app")
        advanceUntilIdle()

        assertEquals(listOf("https://example.test/app"), launcher.opened.map { it.url })
    }

    @Test
    fun a_consumer_handler_still_wins() = runTest {
        // The escape hatch has to survive: an app with its own review gating — only after N
        // sessions, never during onboarding — must be able to intercept.
        arrange(native = true)
        var seen: String? = null
        val handler: ActionHandler = { value, _ -> seen = value }
        ActionDispatcher.register(mapOf(ActionType.REVIEW to handler))

        ActionDispatcher.dispatch(ActionType.REVIEW, "https://example.test/app")
        advanceUntilIdle()

        assertEquals("https://example.test/app", seen)
    }

    @Test
    fun review_is_not_store() = runTest {
        // They were the same action until now, and conflating them again would quietly restore
        // the old behaviour with no test failing.
        val (review, launcher) = arrange(native = true)

        ActionDispatcher.dispatch(ActionType.STORE, "https://example.test/app")
        advanceUntilIdle()

        assertEquals(0, review.requestCount, "STORE must not request a review")
        assertEquals(1, launcher.opened.size, "STORE must still open the listing")
    }
}
