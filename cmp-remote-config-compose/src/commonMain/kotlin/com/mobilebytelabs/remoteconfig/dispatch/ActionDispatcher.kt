package com.mobilebytelabs.remoteconfig.dispatch

import co.touchlab.kermit.Logger
import com.mobilebytelabs.kmptoolkit.appreview.AppReview
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import com.mobilebytelabs.kmptoolkit.openurl.AppHint
import com.mobilebytelabs.kmptoolkit.openurl.OpenUrlResult
import com.mobilebytelabs.kmptoolkit.openurl.UrlLauncher
import com.mobilebytelabs.kmptoolkit.openurl.canOpen
import com.mobilebytelabs.kmptoolkit.openurl.openInBrowser
import com.mobilebytelabs.kmptoolkit.openurl.openUrl
import com.mobilebytelabs.kmptoolkit.openurl.openWithApp
import com.mobilebytelabs.remoteconfig.model.ActionType

/**
 * Routes a CTA to its destination.
 *
 * ── Why the SDK does this, not the consumer ──────────────────────────────────────────────────
 * `cta_action` is authored in the DASHBOARD. An operator writes a store link or a policy URL and
 * publishes it; nobody rebuilds the app. If acting on it were the consumer's job, every app
 * would need a handler per action type before any CTA worked — and the failure when they did
 * not was SILENT: URL, DEEPLINK and STORE sat in a `BUILT_IN` set that suppressed the "no
 * handler registered" warning and then dropped the action. The button rendered, the user
 * tapped, nothing happened and nothing logged.
 *
 * Destinations now resolve through KmpToolkit's `cmp-open-url` — same provenance as
 * `cmp-observe`, and already where the expect/actual launcher lives for every platform family.
 *
 * A consumer-registered handler still WINS: an app with its own in-app router for deeplinks must
 * not have the SDK open an external browser over the top of it.
 */
internal object ActionDispatcher {
    private val handlers = mutableMapOf<ActionType, ActionHandler>()
    private val log = Logger.withTag("RemoteConfig")

    /**
     * An interface rather than calling `openUrl(...)` directly, because a top-level function
     * cannot be substituted — which is why `UrlLauncher` exists in that library. Without it
     * these destinations would be untestable without launching a real browser.
     */
    private var launcher: UrlLauncher = PlatformUrlLauncher

    private object PlatformUrlLauncher : UrlLauncher {
        override fun open(url: String): Boolean = openUrl(url)
        override fun openInBrowser(url: String): Boolean = openInBrowser(url)
        override fun openWith(url: String, appHint: AppHint): OpenUrlResult = openWithApp(url, appHint)
        override fun canOpen(url: String): Boolean = canOpen(url)
    }

    internal fun setLauncherForTest(value: UrlLauncher) { launcher = value }
    internal fun resetLauncher() { launcher = PlatformUrlLauncher }

    /**
     * Where a suspending built-in runs.
     *
     * `AppReview.requestReview()` suspends — the platform sheet is asynchronous — but `dispatch`
     * is called from a tap handler and cannot be. Rather than make every caller supply a scope
     * for the one action that needs it, the dispatcher owns a Main-dispatched scope: the review
     * sheet is UI and has to be requested from the main thread anyway.
     *
     * A SupervisorJob so a failed review request cannot cancel the scope and silently disable
     * every later one.
     */
    private var scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    internal fun setScopeForTest(value: CoroutineScope) { scope = value }
    internal fun resetScope() { scope = CoroutineScope(SupervisorJob() + Dispatchers.Main) }

    fun register(map: Map<ActionType, ActionHandler>) {
        handlers.clear()
        handlers.putAll(map)
    }

    fun dispatch(type: ActionType, value: String?) {
        // The consumer's handler wins. Running both would be two navigations from one tap.
        handlers[type]?.let { handler ->
            handler(value, ActionContext())
            return
        }

        when (type) {
            // `store_url` is a full URL in every schema that carries one, so STORE is a URL open
            // under a different name rather than a separate platform capability.
            ActionType.REVIEW -> {
                // The native sheet, not a store link. `requestReview` is rate-limited and
                // silently ignored by both platforms when it has been shown too recently —
                // which is correct behaviour, not a failure, so nothing here treats a
                // no-op result as an error.
                //
                // `value` carries the template's `store_url` and is used only if the platform
                // has no native sheet: desktop and web have no review API, and sending those
                // users to the listing is better than doing nothing at all.
                scope.launch {
                    val result = runCatching { AppReview.requestReview() }
                        .onFailure { log.w { "in-app review failed: ${it::class.simpleName}" } }
                    if (result.isFailure || !AppReview.capabilities.nativeInAppReview) {
                        val fallback = value?.trim()
                        if (!fallback.isNullOrEmpty()) launcher.open(fallback)
                        else AppReview.openStoreListing()
                    }
                }
            }

            ActionType.URL, ActionType.DEEPLINK, ActionType.STORE -> {
                val target = value?.trim()
                if (target.isNullOrEmpty()) {
                    // An operator can save a CTA with no destination. Handing "" to a platform
                    // launcher is an error dialog on some targets and silence on others.
                    log.w { "action_type='${type.value}' has no destination — nothing to open" }
                    return
                }
                if (!launcher.open(target)) {
                    // Reported, never swallowed: "the button does nothing" is the complaint this
                    // dispatcher exists to make diagnosable.
                    log.w { "could not open '$target' for action_type='${type.value}'" }
                }
            }

            // Terminal in the UI layer — the surface dismisses itself. Routing these to a
            // launcher would try to open the literal string "dismiss".
            ActionType.DISMISS, ActionType.NONE, ActionType.ACKNOWLEDGE, ActionType.SUBMIT -> Unit

            // PREMIUM has no universal destination: what "go premium" means is the app's own
            // paywall or purchase flow, so it stays a consumer responsibility and says so.
            ActionType.PREMIUM ->
                log.w { "action_type='premium' needs a handler: only the app knows its purchase flow" }

            // A type this SDK version has never seen — a template added to the control plane
            // after it shipped. Passing the value to a URL launcher on the chance it might be a
            // link is how an app opens a browser on a string meant for something else.
            else -> log.w { "No handler registered for action_type='${type.value}' (value=$value)" }
        }
    }

    internal fun clear() {
        handlers.clear()
    }

}
