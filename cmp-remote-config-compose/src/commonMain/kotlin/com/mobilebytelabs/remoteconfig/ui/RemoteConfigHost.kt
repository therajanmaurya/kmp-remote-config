package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mobilebytelabs.remoteconfig.dispatch.ActionDispatcher
import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.model.DisplayType
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import com.mobilebytelabs.remoteconfig.model.Template
import com.mobilebytelabs.remoteconfig.ui.templates.DesignedTemplateBody
import com.mobilebytelabs.remoteconfig.ui.templates.TemplateActions
import com.mobilebytelabs.remoteconfig.ui.templates.hasDesignedBody
import org.koin.compose.viewmodel.koinViewModel

/**
 * Render the remote-config surface this screen should show.
 *
 * ── Declaring what a screen hosts ───────────────────────────────────────────────────────────
 * Name the templates this screen is willing to show, and only those are considered here:
 *
 *     @Composable
 *     fun HomeScreen() {
 *         // …your screen…
 *         RemoteConfigHost(Template.UpdateAvailable, Template.PolicyUpdate)
 *     }
 *
 * Name none and it behaves as it always did — whichever config the evaluator picks, app-wide:
 *
 *     RemoteConfigHost()
 *
 * The scope is a statement about the SCREEN, which is why it belongs in code rather than only
 * on the dashboard. `config.screens[]` can target a screen by name, but that couples an
 * operator's targeting to strings that must match route names they cannot see, and nothing
 * fails when they drift. Declaring it at the call site means a paywall cannot surface on a
 * settings screen because the settings screen never said it hosts one. The two compose: the
 * server still targets, and this bounds what the screen will accept.
 *
 * ── What is NOT re-implemented here ─────────────────────────────────────────────────────────
 * Selection runs through the same `RemoteConfigEvaluator` as the unscoped path, just over a
 * filtered list — so impression caps, dismissal and cooldown keep their single definition. A
 * config capped at one impression shows once and, after the user reopens the app, does not show
 * again; that is the evaluator's behaviour and scoping does not get its own copy of it.
 *
 * Priority still breaks ties: if two named templates are eligible at once, the higher
 * `priority` wins and the other remains eligible for the next composition.
 *
 * ── Action routing ──────────────────────────────────────────────────────────────────────────
 * - Pass [onAction] for explicit per-screen control (escape hatch).
 * - Omit [onAction] and use the `action(...)` DSL inside `remoteConfig { … }` — actions
 *   dispatch to your registered handlers via [ActionDispatcher], and URL / DEEPLINK / STORE
 *   resolve with no handler registered at all.
 *
 * @param templates the templates this screen hosts. Empty = no scope, the previous behaviour.
 */
@Composable
fun RemoteConfigHost(
    vararg templates: Template,
    viewModel: RemoteConfigViewModel = koinViewModel(),
    onAction: ((actionType: ActionType, actionValue: String?) -> Unit)? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // `templates` is a vararg, so it is a fresh array on every call and cannot be a remember
    // key — keyed on it directly, the memo below would miss every time. The Set is.
    val scope: Set<String> = templates.mapTo(mutableSetOf()) { it.id }

    val config = remember(scope, state.delivered, state.suppressed, state.activeConfig) {
        if (scope.isEmpty()) state.activeConfig else viewModel.activeFor(scope)
    } ?: return

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

    val display = DisplayType.from(config.display) ?: return

    // A DESIGNED body for this template takes precedence. StaticConfigRenderer below remains
    // the path for custom templates and for builtins added to the control plane after this SDK
    // shipped — so it is the forward-compatibility story, not dead code. Without it, every new
    // template would be a mandatory SDK upgrade.
    if (hasDesignedBody(config.template)) {
        // A template that requires acknowledgement must not be escapable: the surface is
        // dismissible only when the ITEM says so AND the template does not demand a positive
        // answer. A forced update sets is_dismissible=false for the same reason.
        val dismissible = config.isDismissible && !config.requiresAck
        TemplateSurface(
            display = display,
            dismissible = dismissible,
            onDismiss = { viewModel.onConfigDismissed(config.id) },
        ) {
            DesignedTemplateBody(
                item = config,
                actions = TemplateActions(
                    onPrimary = { type, value ->
                        handle(ActionType(type), value)
                        viewModel.onActionClicked(config.id)
                    },
                    onSecondary = { viewModel.onConfigDismissed(config.id, permanent = true) },
                    onDismiss = { viewModel.onConfigDismissed(config.id) },
                ),
            )
        }
        return
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
