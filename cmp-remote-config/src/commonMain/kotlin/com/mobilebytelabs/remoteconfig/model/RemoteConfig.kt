package com.mobilebytelabs.remoteconfig.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RemoteConfig(
    val id: String = "",
    val platform: String = "all",
    @SerialName("min_app_version") val minAppVersion: String? = null,
    @SerialName("max_app_version") val maxAppVersion: String? = null,
    val title: String = "",
    val description: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("display_type") val displayType: String = "dialog",
    val priority: Int = 0,
    @SerialName("is_dismissible") val isDismissible: Boolean = true,
    @SerialName("action_text") val actionText: String? = null,
    @SerialName("action_type") val actionType: String = "none",
    @SerialName("action_value") val actionValue: String? = null,
    @SerialName("secondary_action_text") val secondaryActionText: String? = null,
    @SerialName("secondary_action_type") val secondaryActionType: String = "dismiss",
    @SerialName("secondary_action_value") val secondaryActionValue: String? = null,
    @SerialName("max_impressions") val maxImpressions: Int = 1,
    @SerialName("cooldown_hours") val cooldownHours: Int = 24,
    @SerialName("start_at") val startAt: String? = null,
    @SerialName("end_at") val endAt: String? = null,
    @SerialName("is_enabled") val isEnabled: Boolean = true,
    @SerialName("accent_color") val accentColor: String? = null,
    @SerialName("icon_emoji") val iconEmoji: String? = null,
    @SerialName("content_json") val contentJson: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

enum class DisplayType(val value: String) {
    DIALOG("dialog"),
    FULLSCREEN("fullscreen"),
    BANNER("banner"),
    BOTTOM_SHEET("bottom_sheet"),
    ;

    companion object {
        /**
         * The presentation for a server-supplied `display`, or null when there is none.
         *
         * Returns null rather than defaulting to [DIALOG]. `"none"` is a value-only config
         * (a feature flag read through the typed getters) and must never put a modal on
         * screen, and a display added to the control plane later reaches an older SDK as an
         * unknown string — rendering nothing is the only safe answer such a client can give.
         */
        fun from(value: String): DisplayType? = entries.find { it.value == value }
    }
}

@Serializable
data class DeviceImpression(
    @SerialName("config_id") val configId: String = "",
    val impressions: Int = 0,
    val dismissed: Boolean = false,
)

/**
 * Open value-class action_type. Built-in constants live on the companion;
 * consumers extend with their own typed constants (recommended pattern):
 *
 * ```
 * object RemoteActions {
 *     val OPEN_DOWNLOADS = ActionType("open_downloads")
 *     val CLEAR_CACHE    = ActionType("clear_cache")
 * }
 * ```
 *
 * Semantics are convention — the library does NOT auto-handle any built-in.
 * Consumer wires them up via `action(...)` DSL inside `remoteConfig { … }`,
 * or via the `RemoteConfigHost(onAction = …)` escape hatch.
 */
@kotlin.jvm.JvmInline
value class ActionType(val value: String) {
    companion object {
        val NONE = ActionType("none")
        val URL = ActionType("url")
        val DEEPLINK = ActionType("deeplink")
        val STORE = ActionType("store")

        /**
         * Ask for a store review — natively, in place, not by opening the store.
         *
         * Distinct from [STORE] because they are different acts. STORE sends the user away to a
         * listing; REVIEW shows the platform's own review sheet over the app, which is the whole
         * reason the native APIs exist and why they convert where a store link does not.
         *
         * Falls back to the listing when the platform has no native sheet, so a caller never has
         * to ask which one it is going to get.
         */
        val REVIEW = ActionType("review")
        val DISMISS = ActionType("dismiss")
        val PREMIUM = ActionType("premium")

        /**
         * Positive acknowledgement of something the user had to see — the "I agree" on a
         * policy_update, whose template declares `requires_ack`.
         *
         * Distinct from DISMISS on purpose: both close the surface, but only one is a record
         * that the user ACCEPTED. Collapsing them would make a compliance surface
         * indistinguishable from someone tapping the backdrop.
         */
        val ACKNOWLEDGE = ActionType("acknowledge")

        /**
         * The user supplied a value — an NPS score, a survey answer. The value travels in the
         * action's `actionValue`, which is why a submit with nothing selected must not fire.
         */
        val SUBMIT = ActionType("submit")
    }
}
