package com.mobilebytelabs.remoteconfig.ui.templates

import com.mobilebytelabs.remoteconfig.model.ActionType

/**
 * Split a `cta_action` payload field into an action type and its destination.
 *
 * ── The hole this fills ──────────────────────────────────────────────────────────────────────
 * Templates like `announcement`, `notification`, `paywall_upsell` and `promo_offer` carry a
 * `cta_label` and a `cta_action` and NO separate URL field. So `cta_action` has to express both
 * the intent and the destination — `url:https://example.com/pricing` — and the bodies were
 * doing this:
 *
 *     a.onPrimary(p.string("cta_action", …), p.string("cta_action"))
 *
 * passing the SAME string as both the type and the value. The dispatcher then saw an action type
 * of `"url:https://example.com/pricing"`, matched nothing, and logged "no handler registered".
 * Every CTA on those four templates was unreachable no matter what the dispatcher did — which is
 * why fixing the dispatcher alone would not have made a single one of them work.
 *
 * ── What it accepts ──────────────────────────────────────────────────────────────────────────
 *     "url:https://x"      → URL,      "https://x"
 *     "store:https://x"    → STORE,    "https://x"
 *     "deeplink:myapp://x" → DEEPLINK, "myapp://x"
 *     "dismiss"            → DISMISS,  null
 *     "https://x"          → URL,      "https://x"       bare URL, operator convenience
 *     "myapp://settings"   → DEEPLINK, "myapp://settings"
 *     "redeem_offer"       → custom,   null              a host-registered type
 *
 * The bare-URL case matters: an operator typing a link into a field labelled "action" is the
 * obvious thing to do, and refusing it on a technicality would be the product being pedantic at
 * the person it exists to serve.
 *
 * The prefix check is deliberately against the KNOWN types only. Treating any `word:rest` as a
 * typed action would make `myapp://settings` parse as type `myapp` with value `//settings`,
 * which is why the scheme test below looks for `://` before falling back to DEEPLINK.
 */
internal data class CtaAction(val type: ActionType, val value: String?)

private val TYPED_PREFIXES: Map<String, ActionType> = mapOf(
    "url" to ActionType.URL,
    "store" to ActionType.STORE,
    "deeplink" to ActionType.DEEPLINK,
    "premium" to ActionType.PREMIUM,
    "dismiss" to ActionType.DISMISS,
    "acknowledge" to ActionType.ACKNOWLEDGE,
    "submit" to ActionType.SUBMIT,
)

internal fun parseCtaAction(raw: String?, fallback: ActionType = ActionType.DISMISS): CtaAction {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty()) return CtaAction(fallback, null)

    // `type:rest` where type is one we know. Checked before the URL shapes so an explicit
    // `url:https://x` wins over the bare-URL heuristic rather than racing it.
    val head = text.substringBefore(':', missingDelimiterValue = "").lowercase()
    val known = TYPED_PREFIXES[head]
    if (known != null) {
        val rest = text.substringAfter(':', missingDelimiterValue = "").trim()
        return CtaAction(known, rest.ifEmpty { null })
    }

    // A bare value with no recognised prefix.
    return when {
        // http(s) is a web destination.
        text.startsWith("http://", ignoreCase = true) ||
            text.startsWith("https://", ignoreCase = true) -> CtaAction(ActionType.URL, text)

        // Any other scheme — `myapp://`, `mailto:`, `tel:` — is a platform link, which on every
        // target means "hand it to the system and let the registered handler take it".
        text.contains("://") -> CtaAction(ActionType.DEEPLINK, text)

        // A bare word: a type with no destination. `dismiss` lands here via the map above; a
        // name this SDK does not know becomes a custom ActionType so a host-registered handler
        // can still claim it.
        else -> CtaAction(TYPED_PREFIXES[text.lowercase()] ?: ActionType(text), null)
    }
}
