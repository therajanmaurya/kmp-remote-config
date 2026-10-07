package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
                shape = RoundedCornerShape(24.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
            ) {
                Surface(modifier = Modifier.padding(24.dp), color = MaterialTheme.colorScheme.surface) { body() }
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
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp, vertical = 48.dp),
                    color = MaterialTheme.colorScheme.background,
                ) { body() }
            }
        }

        // A banner is INLINE chrome — no Dialog, because it sits in the host's own layout
        // rather than over it. Wrapping it in a Dialog is what would make a "banner" a modal.
        DisplayType.BANNER -> Surface(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 2.dp,
        ) {
            Surface(modifier = Modifier.padding(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) { body() }
        }

        DisplayType.BOTTOM_SHEET -> Dialog(
            onDismissRequest = { if (dismissible) onDismiss() },
            properties = DialogProperties(
                dismissOnBackPress = dismissible,
                dismissOnClickOutside = dismissible,
                usePlatformDefaultWidth = false,
            ),
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                    color = MaterialTheme.colorScheme.surface,
                ) { body() }
            }
        }
    }
}
