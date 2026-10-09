package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.runtime.Composable
import com.mobilebytelabs.remoteconfig.dispatch.ActionDispatcher
import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.model.DisplayType
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import com.mobilebytelabs.remoteconfig.ui.templates.DesignedTemplateBody
import com.mobilebytelabs.remoteconfig.ui.templates.TemplateActions
import com.mobilebytelabs.remoteconfig.ui.templates.hasDesignedBody

/**
 * Render ONE config that the caller chose, rather than whichever one the evaluator picked.
 *
 * [RemoteConfigHost] is the right entry point for normal delivery: it renders the active config,
 * records the impression, and honours dismissal and cooldown. This is the entry point for the
 * cases where the app — not the evaluator — decides what to show:
 *
 *  - a gallery or preview screen that walks every template the control plane delivered
 *  - a debug surface for checking how a config looks before it reaches users
 *  - showing a specific surface at a moment the app chooses
 *
 * Without it those cases had no supported path at all: `TemplateSurface` and
 * `DesignedTemplateBody` are `internal`, so a consumer could not render a known item even when
 * holding it. The sample needed exactly this to show all fourteen templates, which is a strong
 * signal that real consumers will too.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────────────────────
 * No impression recording, no dismissal bookkeeping, no cooldown. Those belong to DELIVERY, and
 * a preview that burned a config's single impression — `max_impressions` defaults to 1 — would
 * mean looking at a surface consumed the one chance a real user had to see it. The caller asked
 * for this item explicitly, so the evaluator's accounting is not involved.
 *
 * That is also why it is a separate function rather than a flag on [RemoteConfigHost]: the two
 * have opposite relationships to the item's lifecycle, and one function doing both would make
 * the dangerous behaviour reachable by passing a boolean.
 */
@Composable
public fun RemoteConfigSurface(
    item: RemoteConfigItem,
    onAction: ((actionType: ActionType, actionValue: String?) -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    // Unknown display: render nothing rather than guess. Reaching here means a display this SDK
    // version does not know, which is the forward-compatibility case — a newer control plane
    // talking to an older app.
    val display = DisplayType.from(item.display) ?: return

    val handle: (ActionType, String?) -> Unit = { type, value ->
        if (onAction != null) onAction(type, value) else ActionDispatcher.dispatch(type, value)
    }

    if (hasDesignedBody(item.template)) {
        // Same rule as delivery: a template demanding acknowledgement must not be escapable,
        // so the surface is dismissible only when the ITEM allows it AND the template does not
        // require a positive answer. Keeping this identical to RemoteConfigHost matters — a
        // preview that could be swiped away while the real thing cannot would be showing the
        // operator something other than what ships.
        val dismissible = item.isDismissible && !item.requiresAck
        TemplateSurface(
            display = display,
            dismissible = dismissible,
            onDismiss = { onDismiss?.invoke() },
        ) {
            DesignedTemplateBody(
                item = item,
                actions = TemplateActions(
                    onPrimary = { type, value -> handle(ActionType(type), value) },
                    onSecondary = { onDismiss?.invoke() },
                    onDismiss = { onDismiss?.invoke() },
                ),
            )
        }
        return
    }

    // No designed body: the generic renderer, which is how a template added to the control plane
    // after this SDK shipped still displays. Without this path every new template would be a
    // mandatory SDK upgrade.
    val content = ConfigContent.from(item)
    val primary: () -> Unit = { handle(ActionType(content.actionType), content.actionValue) }
    val dismiss: () -> Unit = { onDismiss?.invoke() }

    when (display) {
        DisplayType.DIALOG -> RemoteConfigDialog(content, primary, dismiss, dismiss)
        DisplayType.FULLSCREEN -> RemoteConfigFullScreen(content, primary, dismiss, dismiss)
        DisplayType.BANNER -> RemoteConfigBanner(content, primary, dismiss)
        DisplayType.BOTTOM_SHEET -> RemoteConfigBottomSheet(content, primary, dismiss, dismiss)
    }
}
