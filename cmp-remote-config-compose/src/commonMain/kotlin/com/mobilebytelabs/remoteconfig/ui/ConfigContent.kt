package com.mobilebytelabs.remoteconfig.ui

import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * The display strings a presentation needs, derived from a config's opaque `payload`.
 *
 * The payload is template-shaped and deliberately NOT flattened in the wire model, because
 * the fifteen builtins genuinely disagree about their fields: `announcement` has title/body,
 * `update_available` has store_url/forced/release_notes/current_version and no title at all,
 * `paywall_upsell` leads with a headline. Reading `payload.title` directly — which the
 * dashboard preview originally did — renders an empty overlay for most templates.
 *
 * So the mapping is by ROLE, with per-template knowledge where the role is not guessable
 * from the key name. Falling back to the first plausible key keeps an unknown or custom
 * template renderable rather than blank.
 */
data class ConfigContent(
    val title: String,
    val description: String?,
    val actionText: String?,
    val secondaryActionText: String?,
    val iconEmoji: String?,
    val isDismissible: Boolean,
    /**
     * What the primary button DOES, as an [com.mobilebytelabs.remoteconfig.model.ActionType]
     * value — derived from the payload by role, the same way the strings are.
     */
    val actionType: String,
    val actionValue: String?,
) {
    companion object {
        /** Keys that act as a headline, most specific first. */
        private val TITLE_KEYS = listOf("title", "headline", "heading", "question", "version")

        /** Keys that act as body copy. `release_notes` is update_available's body. */
        private val BODY_KEYS = listOf("body", "summary", "message", "description", "release_notes", "notes")

        /** Keys carrying the primary action's DESTINATION, most specific first. */
        private val URL_KEYS = listOf("store_url", "url", "link", "deeplink", "target")

        /** Keys that label the primary action. */
        private val CTA_KEYS = listOf("cta_label", "primary_action_label", "action_label", "button_label")

        fun from(item: RemoteConfigItem): ConfigContent {
            val p = item.payload
            return ConfigContent(
                title = p.firstString(TITLE_KEYS)
                    ?: defaultTitleFor(item.template)
                    ?: item.template.replace('_', ' ').replaceFirstChar { it.uppercase() },
                description = p.firstString(BODY_KEYS),
                actionText = p.firstString(CTA_KEYS) ?: defaultCtaFor(item.template),
                secondaryActionText = if (item.isDismissible) DEFAULT_SECONDARY else null,
                iconEmoji = null,
                isDismissible = item.isDismissible,
                actionType = if (p.firstString(URL_KEYS) != null) ACTION_OPEN_URL else ACTION_DISMISS,
                actionValue = p.firstString(URL_KEYS),
            )
        }

        /**
         * A headline for templates whose schema carries none.
         *
         * `update_available` is the motivating case: its fields are store_url / forced /
         * release_notes / current_version, so without this the most important overlay in the
         * product would render with an empty title bar.
         */
        private fun defaultTitleFor(template: String): String? = when (template) {
            "update_available" -> "Update available"
            "rating_prompt" -> "Enjoying the app?"
            "whats_new" -> "What's new"
            else -> null
        }

        private fun defaultCtaFor(template: String): String? = when (template) {
            "update_available" -> "Update"
            "rating_prompt" -> "Rate"
            "policy_update" -> "I agree"
            "whats_new" -> "Got it"
            else -> null
        }

        private const val DEFAULT_SECONDARY = "Not now"

        /**
         * A payload with no destination gets DISMISS, never a no-op. A button that looks
         * tappable and does nothing is the dead-clickable defect the framework gates for.
         */
        private const val ACTION_OPEN_URL = "open_url"
        private const val ACTION_DISMISS = "dismiss"

        private fun JsonObject.firstString(keys: List<String>): String? {
            for (k in keys) {
                val v = this[k] ?: continue
                val prim = v as? JsonPrimitive ?: continue
                if (!prim.isString) continue
                val s = prim.content
                if (s.isNotBlank()) return s
            }
            return null
        }
    }
}

/** True when the payload asks for a non-dismissible presentation (forced update, acks). */
internal fun RemoteConfigItem.isForced(): Boolean =
    requiresAck || (payload["forced"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() == true)
