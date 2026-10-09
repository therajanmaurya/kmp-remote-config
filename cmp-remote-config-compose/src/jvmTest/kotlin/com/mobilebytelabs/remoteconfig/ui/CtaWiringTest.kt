package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.kmptoolkit.openurl.testing.FakeUrlLauncher
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
}
