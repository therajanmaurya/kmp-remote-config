package com.mobilebytelabs.remoteconfig.dispatch

import com.mobilebytelabs.kmptoolkit.openurl.testing.FakeUrlLauncher
import com.mobilebytelabs.remoteconfig.model.ActionType
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The built-in actions must actually DO something.
 *
 * `ActionDispatcher` listed URL, DEEPLINK and STORE in a `BUILT_IN` set, which suppressed the
 * "no handler registered" warning — and then dropped them. The one case the set existed for was
 * the one case that silently did nothing: an operator fills `cta_action` on the dashboard, the
 * button renders, the user taps it, and the SDK goes nowhere and logs nothing. Every consumer
 * had to register a handler per action type before any CTA worked, which is precisely the
 * per-app work this library exists to remove.
 *
 * These pin that destinations resolve with NO consumer registration, and that a consumer who
 * does register still wins.
 *
 * They could not run at all until this repo's jvmTarget was raised to 21: KmpToolkit publishes
 * its JVM artifacts at Java 21, so on JVM 11 nothing from `cmp-open-url` would load — including
 * `FakeUrlLauncher`, which left the behaviour untestable on the one target this suite runs on.
 */
class BuiltInActionTest {

    @AfterTest
    fun tearDown() {
        ActionDispatcher.clear()
        ActionDispatcher.resetLauncher()
    }

    private fun fake(): FakeUrlLauncher {
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)
        return launcher
    }

    @Test
    fun a_url_action_opens_the_url_with_no_consumer_handler() {
        val launcher = fake()
        ActionDispatcher.dispatch(ActionType.URL, "https://example.test/terms")
        assertEquals(listOf("https://example.test/terms"), launcher.opened.map { it.url })
    }

    @Test
    fun a_store_action_opens_the_store_url() {
        // `store_url` is already a full URL in every template schema carrying one, so STORE is a
        // URL open under a different name — not a separate platform capability.
        val launcher = fake()
        ActionDispatcher.dispatch(ActionType.STORE, "https://play.google.com/store/apps/details?id=x")
        assertEquals(1, launcher.opened.size)
    }

    @Test
    fun a_deeplink_action_opens_the_link() {
        val launcher = fake()
        ActionDispatcher.dispatch(ActionType.DEEPLINK, "myapp://settings/backup")
        assertEquals(listOf("myapp://settings/backup"), launcher.opened.map { it.url })
    }

    @Test
    fun a_consumer_handler_wins_and_the_sdk_does_not_also_open() {
        // The escape hatch must keep working: an app with its own in-app router for deeplinks
        // must not get an external browser opened over the top of it. Two navigations from one
        // tap is worse than either alone.
        val launcher = fake()
        var seen: String? = null
        val handler: ActionHandler = { value, _ -> seen = value }
        ActionDispatcher.register(mapOf(ActionType.URL to handler))

        ActionDispatcher.dispatch(ActionType.URL, "https://example.test/x")

        assertEquals("https://example.test/x", seen)
        assertTrue(launcher.opened.isEmpty(), "the SDK must not ALSO open it")
    }

    @Test
    fun a_missing_or_blank_destination_opens_nothing() {
        // An operator can save a CTA with no destination. Handing "" to a platform launcher is
        // an error dialog on some targets and silence on others.
        val launcher = fake()
        ActionDispatcher.dispatch(ActionType.URL, null)
        ActionDispatcher.dispatch(ActionType.URL, "   ")
        assertTrue(launcher.opened.isEmpty())
    }

    @Test
    fun terminal_actions_open_nothing() {
        // DISMISS/NONE/ACKNOWLEDGE/SUBMIT resolve in the UI layer. Routing them to a launcher
        // would try to open the literal string "dismiss".
        val launcher = fake()
        for (t in listOf(ActionType.DISMISS, ActionType.NONE, ActionType.ACKNOWLEDGE, ActionType.SUBMIT)) {
            ActionDispatcher.dispatch(t, "dismiss")
        }
        assertTrue(launcher.opened.isEmpty())
    }

    @Test
    fun an_unknown_action_type_is_not_speculatively_opened() {
        // A template added to the control plane after this SDK shipped can carry an action type
        // this version has never seen. Passing its value to a URL launcher on the chance it
        // might be a link is how an app opens a browser on a string meant for something else.
        val launcher = fake()
        ActionDispatcher.dispatch(ActionType("redeem_offer"), "LUMEN3")
        assertTrue(launcher.opened.isEmpty())
    }

    @Test
    fun a_launcher_that_refuses_does_not_throw() {
        // `canOpen` false → no installed handler for the scheme. The user sees nothing happen,
        // which is bad, but an exception out of a tap handler crashes the host app, which is
        // worse. The dispatcher logs and returns.
        val launcher = FakeUrlLauncher(canOpenPredicate = { false })
        ActionDispatcher.setLauncherForTest(launcher)
        ActionDispatcher.dispatch(ActionType.URL, "weird-scheme://nothing-handles-this")
        assertTrue(launcher.refused.isNotEmpty(), "the launcher should have recorded the refusal")
    }
}
