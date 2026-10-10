package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.kmptoolkit.appreview.AppReview
import com.mobilebytelabs.kmptoolkit.appreview.AppReviewCapabilities
import com.mobilebytelabs.kmptoolkit.appreview.testing.FakeAppReviewManager
import com.mobilebytelabs.kmptoolkit.openurl.testing.FakeUrlLauncher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import com.mobilebytelabs.remoteconfig.dispatch.ActionDispatcher
import com.mobilebytelabs.remoteconfig.dispatch.ActionHandler
import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The CTA chain, end to end, through the real renderer.
 *
 * ── Why the unit tests either side of this were not enough ──────────────────────────────────
 * `BuiltInActionTest` proves the dispatcher opens a URL it is HANDED. `CtaActionTest` proves
 * `cta_action` parses. Both passed while every CTA in the product was dead, because the defect
 * lived in the two lines BETWEEN them:
 *
 *     a.onPrimary(p.string("cta_action", …), p.string("cta_action"))
 *
 * The same string as both the type and the destination. The dispatcher received an action type of
 * `"url:https://…"`, matched nothing, logged a warning, and the user's tap went nowhere. No test
 * on either side of that line could see it — which is the whole reason this file renders the real
 * surface and clicks the real button instead of asserting about the pieces.
 *
 * So these tests start from an operator-authored payload, go through `RemoteConfigSurface` →
 * template body → `TemplateActions` → `ActionDispatcher` → launcher, and assert on what the
 * platform was finally asked to open. That is the claim the product makes — "fill it in on the
 * dashboard and the SDK handles it" — and nothing short of this chain tests it.
 */
@OptIn(ExperimentalTestApi::class)
class CtaWiringTest {

    private val json = Json { ignoreUnknownKeys = true }

    @AfterTest
    fun tearDown() {
        ActionDispatcher.clear()
        ActionDispatcher.resetLauncher()
    }

    private fun item(template: String, payload: String, display: String = "dialog") =
        RemoteConfigItem(
            id = "wiring-$template",
            template = template,
            payload = json.decodeFromString<JsonObject>(payload),
            display = display,
            isDismissible = true,
            requiresAck = false,
        )

    @Test
    fun an_announcement_cta_opens_the_url_the_operator_typed() {
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "announcement",
                        """{
                          "title": "We shipped scheduling",
                          "body": "Pick a time that suits you.",
                          "cta_label": "See what's new",
                          "cta_action": "url:https://example.test/whats-new"
                        }""",
                    ),
                )
            }
            onNodeWithText("See what's new").performClick()
        }

        assertEquals(
            listOf("https://example.test/whats-new"),
            launcher.opened.map { it.url },
            "the operator's URL must reach the platform launcher with no consumer handler",
        )
    }

    @Test
    fun a_paywall_cta_opens_its_url_on_a_fullscreen_surface() {
        // A different template, a different default action type, and a different surface — the
        // three call sites reading `cta_action` were fixed together and are checked together.
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "paywall_upsell",
                        """{
                          "headline": "Go Pro",
                          "benefits": ["Unlimited projects", "Priority support"],
                          "price_label": "$4.99/mo",
                          "cta_label": "Start free trial",
                          "cta_action": "url:https://example.test/pricing"
                        }""",
                        display = "fullscreen",
                    ),
                )
            }
            onNodeWithText("Start free trial").performClick()
        }

        assertEquals(listOf("https://example.test/pricing"), launcher.opened.map { it.url })
    }

    @Test
    fun a_bare_url_in_cta_action_also_works() {
        // The shape an operator is most likely to type: just the link, no `url:` prefix.
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "announcement",
                        """{
                          "title": "Read the post",
                          "body": "Details on the blog.",
                          "cta_label": "Read more",
                          "cta_action": "https://example.test/blog"
                        }""",
                    ),
                )
            }
            onNodeWithText("Read more").performClick()
        }

        assertEquals(listOf("https://example.test/blog"), launcher.opened.map { it.url })
    }

    @Test
    fun a_dismiss_cta_opens_nothing() {
        // The negative half. A CTA whose action is `dismiss` must close the surface, and must NOT
        // hand the literal string "dismiss" to a URL launcher — which is what a parser that
        // treated every value as a destination would do.
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "announcement",
                        """{
                          "title": "Scheduled maintenance",
                          "body": "We will be back shortly.",
                          "cta_label": "Got it",
                          "cta_action": "dismiss"
                        }""",
                    ),
                )
            }
            onNodeWithText("Got it").performClick()
        }

        assertTrue(launcher.opened.isEmpty(), "a dismiss CTA must not open anything")
    }

    @Test
    fun a_consumer_handler_still_intercepts_the_parsed_action() {
        // The escape hatch, verified through the renderer rather than the dispatcher alone: a
        // host that registers its own URL handler must receive the PARSED destination, not the
        // raw `url:https://…` string it would have to strip itself.
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)
        var seen: Pair<ActionType, String?>? = null
        val handler: ActionHandler = { value, _ -> seen = ActionType.URL to value }
        ActionDispatcher.register(mapOf(ActionType.URL to handler))

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "announcement",
                        """{
                          "title": "Terms updated",
                          "body": "Please review the changes.",
                          "cta_label": "Review",
                          "cta_action": "url:https://example.test/terms"
                        }""",
                    ),
                )
            }
            onNodeWithText("Review").performClick()
        }

        assertEquals(ActionType.URL to "https://example.test/terms", seen)
        assertTrue(launcher.opened.isEmpty(), "the consumer handler won, so the SDK must not also open")
    }

    @Test
    fun the_rating_prompt_asks_for_a_review_rather_than_opening_the_store() {
        // The dispatcher tests prove REVIEW requests a sheet; they say nothing about which
        // action the TEMPLATE sends. Reverting `rating_prompt` to STORE passed all of them —
        // the regression would have shipped with a green suite, which is why this test renders
        // the real body and clicks the real button.
        val review = FakeAppReviewManager(
            capabilities = AppReviewCapabilities(nativeInAppReview = true, storeListing = true),
        )
        AppReview.configure(review)
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)
        ActionDispatcher.setScopeForTest(CoroutineScope(UnconfinedTestDispatcher()))

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "rating_prompt",
                        """{
                          "title": "Enjoying the app?",
                          "body": "A quick rating helps other people find it.",
                          "store_url": "https://play.google.com/store/apps/details?id=x"
                        }""",
                    ),
                )
            }
            onNodeWithText("Rate").performClick()
        }

        assertEquals(1, review.requestCount, "the Rate button did not ask for a native review")
        assertTrue(
            launcher.opened.isEmpty(),
            "the store listing was opened — the user is thrown out of the app by the one " +
                "action meant to keep them in it",
        )
        AppReview.reset()
        ActionDispatcher.resetScope()
    }

    @Test
    fun update_falls_back_to_the_listing_where_in_app_update_does_not_exist() {
        // Named for what it actually proves. On the JVM `AppUpdate.isSupported()` is false, so
        // this is the FALLBACK branch — the one every non-Android target takes, and the one
        // that must never leave the Update button dead.
        //
        // It does NOT distinguish UPDATE from STORE: both end at `launcher.open(store_url)`,
        // so reverting the template to STORE leaves this green. That distinction is pinned by
        // `the_action_carries_the_config_that_fired_it`, which registers a handler for UPDATE
        // specifically. An earlier name here claimed to prove the in-app update started, which
        // it never did.
        //
        // That the Android path requests a real Play flow is verified on a device; it cannot be
        // asserted here, because this library ships no test fake the way cmp-app-review does.
        val launcher = FakeUrlLauncher()
        ActionDispatcher.setLauncherForTest(launcher)
        ActionDispatcher.setScopeForTest(CoroutineScope(UnconfinedTestDispatcher()))

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "update_available",
                        """{
                          "store_url": "https://play.google.com/store/apps/details?id=x",
                          "forced": false,
                          "current_version": "1.0.0",
                          "release_notes": "Fixes."
                        }""",
                    ),
                )
            }
            onNodeWithText("Update").performClick()
        }

        assertEquals(
            listOf("https://play.google.com/store/apps/details?id=x"),
            launcher.opened.map { it.url },
            "the Update button did nothing on a platform with no in-app update",
        )
        ActionDispatcher.resetScope()
    }

    @Test
    fun the_action_carries_the_config_that_fired_it() {
        // ActionContext was empty, so a handler got a bare string and could not tell WHICH
        // config fired. UPDATE needs `forced` from the payload, and consumers wanting to log
        // "which announcement did they tap" needed the same thing.
        var seen: com.mobilebytelabs.remoteconfig.model.RemoteConfigItem? = null
        val handler: ActionHandler = { _, ctx -> seen = ctx.config }
        ActionDispatcher.register(mapOf(ActionType.UPDATE to handler))

        runComposeUiTest {
            setContent {
                RemoteConfigSurface(
                    item(
                        "update_available",
                        """{"store_url":"https://example.test/a","forced":true,"current_version":"1.0.0"}""",
                        display = "fullscreen",
                    ),
                )
            }
            onNodeWithText("Update now").performClick()
        }

        assertEquals("wiring-update_available", seen?.id, "the handler could not see its config")
        assertEquals("update_available", seen?.template)
    }
}
