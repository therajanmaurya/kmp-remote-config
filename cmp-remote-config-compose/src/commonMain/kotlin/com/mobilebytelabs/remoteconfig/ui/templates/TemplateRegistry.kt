package com.mobilebytelabs.remoteconfig.ui.templates

import androidx.compose.runtime.Composable
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem

/**
 * Callbacks a template body can raise. Deliberately three, not an open action bus: a config
 * surface has a primary intent, a decline, and a close, and anything richer belongs in the host
 * app rather than in a remotely-authored overlay.
 */
class TemplateActions(
    val onPrimary: (actionType: String, actionValue: String?) -> Unit,
    val onSecondary: () -> Unit,
    val onDismiss: () -> Unit,
)

/**
 * Per-template content, rendered INSIDE whatever surface the host chose.
 *
 * The split matters: `display` decides the surface (dialog, bottom sheet, banner, fullscreen)
 * and the TEMPLATE decides the content. The same `update_available` is a dialog when optional
 * and a fullscreen when forced — one body, two surfaces — so binding content to surface would
 * have meant writing it twice and letting the two drift.
 */
internal typealias TemplateBody = @Composable (RemoteConfigItem, TemplatePayload, TemplateActions) -> Unit

/**
 * The designed bodies, keyed by template id.
 *
 * Only the templates with a design live here. An id that is absent — a custom template an
 * operator authored, or a builtin added to the control plane after this SDK shipped — falls
 * through to the generic role-derived body, which is why that fallback is not dead code: it is
 * the whole forward-compatibility story. A registry that threw on an unknown id would make
 * every new template a mandatory SDK upgrade.
 */
internal val TEMPLATE_BODIES: Map<String, TemplateBody> = mapOf(
    "announcement" to { item, p, a -> AnnouncementBody(item, p, a) },
    "notification" to { item, p, a -> AnnouncementBody(item, p, a) },
    "update_available" to { item, p, a -> UpdateAvailableBody(item, p, a) },
    "policy_update" to { item, p, a -> PolicyUpdateBody(item, p, a) },
    "paywall_upsell" to { item, p, a -> PaywallBody(item, p, a) },
    "incident_outage" to { item, p, a -> IncidentBody(item, p, a) },
    "information" to { item, p, a -> IncidentBody(item, p, a) },
    "maintenance" to { item, p, a -> IncidentBody(item, p, a) },
    "geo_notice" to { item, p, a -> IncidentBody(item, p, a) },
    "onboarding_tip" to { item, p, a -> IncidentBody(item, p, a) },
    "survey_nps" to { item, p, a -> SurveyNpsBody(item, p, a) },
    "whats_new" to { item, p, a -> WhatsNewBody(item, p, a) },
    "promo_offer" to { item, p, a -> PromoOfferBody(item, p, a) },
    "rating_prompt" to { item, p, a -> RatingPromptBody(item, p, a) },
)

/** Whether a designed body exists for this template. */
internal fun hasDesignedBody(templateId: String): Boolean = TEMPLATE_BODIES.containsKey(templateId)

@Composable
internal fun DesignedTemplateBody(
    item: RemoteConfigItem,
    actions: TemplateActions,
): Boolean {
    val body = TEMPLATE_BODIES[item.template] ?: return false
    body(item, TemplatePayload(item.payload), actions)
    return true
}
