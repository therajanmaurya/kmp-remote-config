package com.mobilebytelabs.remoteconfig.ui.templates

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.onRoot
import io.github.takahirom.roborazzi.captureRoboImage
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import androidx.compose.runtime.CompositionLocalProvider
import com.mobilebytelabs.remoteconfig.model.DisplayType
import com.mobilebytelabs.remoteconfig.ui.LocalRemoteConfigDesign
import com.mobilebytelabs.remoteconfig.ui.designFor
import kotlin.test.Test

/**
 * Golden images for the nine designed template bodies, in BOTH colour schemes.
 *
 * These exist because compiling is not rendering. The registry and payload tests prove the
 * right body is chosen and the right fields are read; nothing proved a body DRAWS. A layout
 * that compiles and renders wrong — a benefit list that collapses, a title clipped to zero
 * height, an action pushed off-screen — passes every other test in this module.
 *
 * JVM-only on purpose. The bodies live in `commonMain` and every target composes the same
 * tree, so a golden captured once covers all of them; running per-platform would compare the
 * same composition against itself and call it coverage.
 *
 * Each test produces two images — `name.png` and `name-dark.png` — from a single `golden(…)`
 * call. Dark was added after the sample gained a real theme made it obvious that the suite
 * pinned layout and nothing about colour: a scheme whose container roles were inverted wrongly,
 * or a hardcoded colour that vanishes on a dark ground, would have passed every check here.
 *
 * **Record goldens** with `./gradlew :cmp-remote-config-compose:jvmTest -Proborazzi.test.record=true`
 * and review the PNGs before committing — a golden accepted without being looked at records
 * whatever the bug produced and then defends it.
 */
@OptIn(ExperimentalTestApi::class)
class TemplateGoldenTest {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * `display` is a REQUIRED argument, not a default.
     *
     * It used to be hardcoded to "dialog" for every fixture, so `paywall_fullscreen`,
     * `promo_sheet` and the rest captured a dialog while their names claimed otherwise. Once
     * the design scaled per surface that stopped being merely untidy: the goldens could not see
     * the scale at all, and would have stayed green through a total regression of it.
     */
    private fun item(
        template: String,
        payload: String,
        display: String,
        dismissible: Boolean = true,
        ack: Boolean = false,
    ) =
        RemoteConfigItem(
            id = "golden-$template",
            template = template,
            payload = json.decodeFromString<JsonObject>(payload),
            display = display,
            isDismissible = dismissible,
            requiresAck = ack,
        )

    /** No-op actions: a golden captures layout, and a tap would only add nondeterminism. */
    private val actions = TemplateActions(
        onPrimary = { _, _ -> },
        onSecondary = {},
        onDismiss = {},
    )

    /**
     * One fixed frame for every capture — a light scheme and a phone-ish width — so a diff
     * means the BODY changed. Letting each test pick its own width would make the goldens
     * incomparable and hide a regression behind a layout difference.
     */
    /**
     * Captures BOTH schemes from one call, so dark coverage cannot drift from light coverage.
     *
     * The alternative — a separate `@Test` per scheme — means every template added later needs
     * someone to remember the dark one, and the suite silently goes half-covered the first time
     * nobody does. Here a new template gets its dark variant whether its author thought about
     * dark mode or not, which is the point: the goldens exist to catch what you did not think
     * to check.
     *
     * Dark is the Material BASELINE scheme, not the sample's brand. These pin what the SDK does
     * on an arbitrary consumer's dark theme; the sample's own palette is the sample's business.
     */
    private fun golden(name: String, item: RemoteConfigItem) {
        capture(name, item, dark = false)
        capture("$name-dark", item, dark = true)
    }

    private fun capture(name: String, item: RemoteConfigItem, dark: Boolean) = runComposeUiTest {
        setContent {
            MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
                // `Surface` supplies the scheme's background and onSurface content colour. Without
                // it a dark capture renders dark-on-dark text over a transparent ground, which
                // reads as a rendering bug rather than the theme working.
                Surface {
                    Box(modifier = Modifier.width(360.dp).padding(24.dp)) {
                        // Provide the design for THIS item's display type, exactly as
                        // TemplateSurface does in the real render path.
                        //
                        // Without it every golden fell back to the DIALOG scale, so a fullscreen
                        // paywall and a dialog captured identically and the per-surface type
                        // scale — the whole point of RemoteConfigDesign — was invisible to the
                        // only automated visual check the project has. The goldens would have
                        // stayed green through a complete regression of it.
                        CompositionLocalProvider(
                            LocalRemoteConfigDesign provides
                                designFor(DisplayType.from(item.display) ?: DisplayType.DIALOG),
                        ) {
                            DesignedTemplateBody(item = item, actions = actions)
                        }
                    }
                }
            }
        }
        onRoot().captureRoboImage("src/jvmTest/roborazzi/$name.png")
    }

    @Test
    fun announcement_dialog() = golden(
        "announcement",
        item("announcement", """{"title":"Introducing saved searches","body":"Keep the filters you use most and jump straight back to them.","cta_label":"Show me"}""", display = "dialog"),
    )

    @Test
    fun update_available_optional() = golden(
        "update_available_optional",
        item("update_available", """{"store_url":"https://play.google.com/store/apps/details?id=com.lumen.photos","forced":false,"release_notes":"Faster library sync and raw export.","current_version":"5.1.0"}""", display = "dialog"),
    )

    /** The same body, `forced` flipped — the decline must be absent, not merely disabled. */
    @Test
    fun update_available_forced() = golden(
        "update_available_forced",
        item(
            "update_available",
            """{"store_url":"https://play.google.com/store/apps/details?id=com.lumen.photos","forced":true,"release_notes":"This version contains a required security fix."}""",
            display = "fullscreen",
            dismissible = false,
        ),
    )

    @Test
    fun policy_update_fullscreen() = golden(
        "policy_update",
        item(
            "policy_update",
            """{"title":"Our terms are changing","summary":"We have clarified how backups are stored and how long deleted albums are retained.","policy_url":"https://example.test/policy","effective_at":"2026-11-01"}""",
            display = "fullscreen",
            dismissible = false,
            ack = true,
        ),
    )

    @Test
    fun paywall_fullscreen() = golden(
        "paywall_upsell",
        item("paywall_upsell", """{"headline":"Go further with Pro","benefits":["Unlimited original-quality backup","Raw export from any album","Shared albums with no member cap"],"price_text":"£4.99 / month","cta_label":"Start free trial"}""", display = "fullscreen"),
    )

    @Test
    fun incident_banner() = golden(
        "incident_outage",
        item("incident_outage", """{"title":"Sync is delayed","body":"New photos may take up to an hour to appear on other devices. Uploads are safe.","severity":"warning","status_url":"https://status.example.test"}""", display = "banner"),
    )

    @Test
    fun survey_nps_sheet() = golden(
        "survey_nps",
        item("survey_nps", """{"question":"How likely are you to recommend Lumen Photos?","follow_up":"Helps us improve backup speeds, album ordering and gallery performance.","scale_min":0,"scale_max":10}""", display = "bottom_sheet"),
    )

    @Test
    fun whats_new_sheet() = golden(
        "whats_new",
        item("whats_new", """{"version":"5.1.0","items":["Raw export from any album","Faster background sync","Shared albums load twice as fast"]}""", display = "bottom_sheet"),
    )

    @Test
    fun promo_sheet() = golden(
        "promo_offer",
        item("promo_offer", """{"headline":"Three months of Pro, on us","body":"Back up every original and export raw files.","offer_code":"LUMEN3","expires_at":"2026-12-31","cta_label":"Claim offer"}""", display = "bottom_sheet"),
    )

    /**
     * The two surfaces this suite did NOT cover, added because changing them revealed the gap:
     * replacing the rating prompt's "★" text glyph with icons, and formatting the maintenance
     * window, both altered what users see and NOTHING went red. Ten goldens over fourteen
     * template ids left the two most visually distinctive bodies unguarded.
     */
    @Test
    fun rating_prompt_dialog() = golden(
        "rating_prompt",
        item("rating_prompt", """{"title":"Enjoying Lumen Photos?","body":"A quick rating helps other people find the app.","store_url":"https://play.google.com/store/apps/details?id=test"}""", display = "dialog"),
    )

    /**
     * The window is the point of this one. It was rendering as a raw pair of ISO instants —
     * `2026-11-15T02:00:00Z — 2026-11-15T04:00:00Z` — straight from the payload.
     */
    @Test
    fun maintenance_banner() = golden(
        "maintenance",
        item("maintenance", """{"title":"Scheduled maintenance","body":"Backup is paused during the window. Nothing already uploaded is affected.","window_start":"2026-11-15T02:00:00Z","window_end":"2026-11-15T04:00:00Z"}""", display = "banner"),
    )

    /**
     * The empty-payload case, captured deliberately: an operator can save a config whose
     * optional fields are all blank, and the result must still be a coherent surface rather
     * than a title bar over nothing. This is the golden most likely to catch a regression in
     * the fallback copy.
     */
    @Test
    fun announcement_with_only_required_fields() = golden(
        "announcement_minimal",
        item("announcement", """{"title":"Scheduled maintenance","body":"We will be back shortly."}""", display = "dialog"),
    )
}
