package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mobilebytelabs.remoteconfig.model.DisplayType

/**
 * The CHROME a designed template body is rendered inside.
 *
 * Split from the body deliberately: `display` decides the surface and the template decides the
 * content, so `update_available` is one body shown as a dialog when optional and as a
 * fullscreen when forced. Collapsing the two would mean writing that body twice and letting
 * the copies drift — which is exactly how the project ended up with a dashboard and an SDK
 * that disagreed.
 *
 * Dismissal honours [dismissible]: a forced update or a policy acknowledgement must not be
 * escapable by a back press or a tap outside, because the whole point of `requires_ack` is
 * that the user cannot pass it by accident.
 */
@Composable
internal fun TemplateSurface(
    display: DisplayType,
    dismissible: Boolean,
    onDismiss: () -> Unit,
    body: @Composable () -> Unit,
) {
    // The whole subtree renders at THIS surface's scale. Bodies stay display-agnostic — the
    // same UpdateAvailableBody is a compact dialog when optional and a hero fullscreen when
    // forced, without a single branch inside it.
    val design = designFor(display)
    CompositionLocalProvider(LocalRemoteConfigDesign provides design) {
    when (display) {
        DisplayType.DIALOG -> Dialog(
            onDismissRequest = { if (dismissible) onDismiss() },
            properties = DialogProperties(
                dismissOnBackPress = dismissible,
                dismissOnClickOutside = dismissible,
                usePlatformDefaultWidth = false,
            ),
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
                shape = design.surfaceShape,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
            ) {
                Surface(
                    modifier = Modifier.padding(design.contentPadding),
                    color = MaterialTheme.colorScheme.surface,
                ) { body() }
            }
        }

        DisplayType.FULLSCREEN -> Dialog(
            onDismissRequest = { if (dismissible) onDismiss() },
            properties = DialogProperties(
                dismissOnBackPress = dismissible,
                dismissOnClickOutside = false,
                usePlatformDefaultWidth = false,
            ),
        ) {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background,
            ) {
                // CENTERED, not top-aligned.
                //
                // This was a plain scrolling Surface, so a paywall — headline, three benefits,
                // a price and two buttons — rendered in the top third with two thirds of the
                // screen empty below it. Nothing was missing; it just looked like a layout
                // nobody had opened. A fullscreen takeover either fills the space or centres in
                // it, and centring is the one that works for content of unknown length.
                //
                // Column rather than Surface because Surface has no arrangement: the scroll
                // modifier has to sit OUTSIDE the arrangement for short content to centre while
                // long content still scrolls from the top, which is what the combination of
                // fillMaxSize + verticalScroll + Arrangement.Center gives.
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = design.contentPadding, vertical = 48.dp),
                    verticalArrangement = Arrangement.Center,
                ) { body() }
            }
        }

        // A banner is INLINE chrome — no Dialog, because it sits in the host's own layout
        // rather than over it. Wrapping it in a Dialog is what would make a "banner" a modal.
        DisplayType.BANNER -> Surface(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            shape = design.surfaceShape,
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 2.dp,
        ) {
            Surface(
                modifier = Modifier.padding(design.contentPadding),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) { body() }
        }

        DisplayType.BOTTOM_SHEET -> Dialog(
            onDismissRequest = { if (dismissible) onDismiss() },
            properties = DialogProperties(
                dismissOnBackPress = dismissible,
                dismissOnClickOutside = dismissible,
                usePlatformDefaultWidth = false,
            ),
        ) {
            // ANCHORED to the bottom edge.
            //
            // `Dialog` centres its content, and the sheet Surface wraps its own height — so
            // without this Box the sheet floated in the MIDDLE of the screen with the host's
            // content visible above and below it. It was a card that happened to be near the
            // centre, which is not a bottom sheet in any sense a user would recognise, and the
            // top-only corners below were meaningless while it hovered.
            //
            // fillMaxSize expands the dialog window to the full screen so BottomCenter has
            // something to align against; without it the Box wraps the sheet and nothing moves.
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.BottomCenter,
            ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                // Top corners only: a sheet is anchored to the bottom edge, and rounding all
                // four makes it read as a card that happens to be low on screen.
                shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(design.contentPadding)
                        // Extra room below the last action. The dialog window ends at the
                        // navigation-bar inset — CMP 1.12's common DialogProperties exposes no
                        // decorFitsSystemWindows, so the sheet cannot paint beneath it — and a
                        // CTA flush against that edge is both ugly and hard to hit next to a
                        // gesture handle.
                        .padding(bottom = design.gap),
                ) {
                    // The DRAG HANDLE. A sheet without one is a panel: the handle is the single
                    // affordance that says "this came up and can go back down", and every
                    // platform sheet has one. Its absence is why these read as dialogs stuck to
                    // the bottom edge.
                    //
                    // Shown only when the sheet can actually be dismissed — a handle on a
                    // surface that refuses to close is a control that lies.
                    if (dismissible) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.CenterHorizontally)
                                .padding(bottom = design.gap)
                                .size(width = 32.dp, height = 4.dp)
                                .background(
                                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                                    RoundedCornerShape(2.dp),
                                ),
                        )
                    }
                    body()
                }
            }
            }
        }
    }
    }
}
