package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.DisplayType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Phase 01 / T3 — an unrecognized `display` must NOT become a dialog.
 *
 * `from()` used to fall back to `DIALOG` for every unmatched string. Two live cases make that
 * a real defect rather than a tidy default:
 *
 * - `"none"` is what the control plane sends for a VALUE-ONLY config (a feature flag read
 *   through the typed getters). Mapping it to DIALOG means a boolean flag can put a modal on
 *   a user's screen.
 * - any display the SERVER adds later — `"carousel"`, `"toast"` — reaches an older SDK as an
 *   unknown string. Guessing DIALOG renders a template in a shape it was never designed for;
 *   rendering nothing is the only safe answer an old client can give.
 */
class DisplayTypeTest {

    @Test
    fun known_displays_map_to_their_presentation() {
        assertEquals(DisplayType.DIALOG, DisplayType.from("dialog"))
        assertEquals(DisplayType.BANNER, DisplayType.from("banner"))
        assertEquals(DisplayType.BOTTOM_SHEET, DisplayType.from("bottom_sheet"))
        assertEquals(DisplayType.FULLSCREEN, DisplayType.from("fullscreen"))
    }

    @Test
    fun a_value_only_config_has_no_presentation() {
        assertNull(
            DisplayType.from("none"),
            "display=none is a feature flag, not a dialog — it must never render",
        )
    }

    @Test
    fun an_unknown_future_display_renders_nothing_rather_than_guessing() {
        assertNull(DisplayType.from("carousel"))
        assertNull(DisplayType.from(""))
    }
}
