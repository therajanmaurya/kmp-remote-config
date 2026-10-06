package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.remoteconfig.dispatch.ActionDispatcher
import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.model.DisplayType
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import org.koin.compose.viewmodel.koinViewModel

/**
 * Render the active remote-config CTA.
 *
 * Action routing:
 * - Pass [onAction] for explicit per-screen control (escape hatch).
 * - Omit [onAction] and use the `action(...)` DSL inside `remoteConfig { … }` —
 *   actions dispatch to your registered handlers via [ActionDispatcher].
 */
@Composable
fun RemoteConfigHost(
    viewModel: RemoteConfigViewModel = koinViewModel(),
    onAction: ((actionType: ActionType, actionValue: String?) -> Unit)? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val config = state.activeConfig ?: return

    LaunchedEffect(config.id) {
        viewModel.onConfigShown(config.id)
    }

    val handle: (ActionType, String?) -> Unit = { type, value ->
        if (onAction != null) {
            onAction(type, value)
        } else {
            ActionDispatcher.dispatch(type, value)
        }
    }

    StaticConfigRenderer(
        item = config,
        onAction = handle,
        viewModel = viewModel,
    )
}

@Composable
private fun StaticConfigRenderer(
    item: RemoteConfigItem,
    onAction: (actionType: ActionType, actionValue: String?) -> Unit,
    viewModel: RemoteConfigViewModel,
) {
    // Derived once per item: the payload is template-shaped, so every display string and the
    // primary action's destination are resolved by role rather than read from fixed columns.
    val config = ConfigContent.from(item)
    val handlePrimaryAction: () -> Unit = {
        onAction(ActionType(config.actionType), config.actionValue)
        viewModel.onActionClicked(item.id)
    }

    val handleSecondaryAction: () -> Unit = {
        // The secondary slot is always the decline path, so it dismisses rather than
        // dispatching: a "Not now" that fired the primary action would be a trap.
        viewModel.onConfigDismissed(item.id, permanent = true)
    }

    val handleDismiss: () -> Unit = {
        viewModel.onConfigDismissed(item.id)
    }

    // No recognized presentation: render nothing. The evaluator already drops `renders_ui`
    // configs, so reaching here means a display this SDK version does not know.
    when (DisplayType.from(item.display) ?: return) {
        DisplayType.DIALOG -> RemoteConfigDialog(
            config = config,
            onPrimaryAction = handlePrimaryAction,
            onSecondaryAction = handleSecondaryAction,
            onDismiss = handleDismiss,
        )

        DisplayType.FULLSCREEN -> RemoteConfigFullScreen(
            config = config,
            onPrimaryAction = handlePrimaryAction,
            onSecondaryAction = handleSecondaryAction,
            onDismiss = handleDismiss,
        )

        DisplayType.BANNER -> RemoteConfigBanner(
            config = config,
            onPrimaryAction = handlePrimaryAction,
            onDismiss = handleDismiss,
        )

        DisplayType.BOTTOM_SHEET -> RemoteConfigBottomSheet(
            config = config,
            onPrimaryAction = handlePrimaryAction,
            onSecondaryAction = handleSecondaryAction,
            onDismiss = handleDismiss,
        )
    }
}
