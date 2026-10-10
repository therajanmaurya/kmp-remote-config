package com.mobilebytelabs.remoteconfig.ui.templates

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Composable
import com.mobilebytelabs.remoteconfig.ui.LocalDesign
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mobilebytelabs.remoteconfig.model.ActionType
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem

/**
 * The designed bodies for the builtin templates, one per `config-templates` mockup.
 *
 * Each reads only the fields ITS OWN schema declares. That is the point of having nine designs
 * rather than one: `update_available` has store_url / forced / release_notes / current_version
 * and no title at all, while `survey_nps` has a question and a numeric scale. A single
 * role-guessing body — which is what shipped before — rendered most of them as an empty dialog
 * with a generic heading.
 */

// ── announcement / notification ──────────────────────────────────────────────
// Mockup 01. Eyebrow chip, title, body, optional inset illustration, primary + decline.
@Composable
internal fun AnnouncementBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn {
        Eyebrow(if (item.template == "notification") "Notice" else "New feature")
        TemplateTitle(p.string("title", "Announcement"))
        p.string("body")?.let { TemplateBodyText(it) }

        // The schema carries an image_url, but an overlay must not block on a network fetch it
        // cannot guarantee — the caption stands in, and the host app can pass a real loader.
        p.string("image_url")?.let {
            InsetCard { Text("Image: $it", style = MaterialTheme.typography.bodySmall) }
        }

        VSpace(4)
        PrimaryAction(p.string("cta_label", "Got it")) {
            parseCtaAction(p.string("cta_action"), fallback = ActionType.DISMISS)
                .let { a.onPrimary(it.type.value, it.value) }
        }
        if (item.isDismissible) SecondaryAction("Not now", a.onSecondary)
    }
}

// ── update_available ─────────────────────────────────────────────────────────
// Mockups 02 (optional, dialog) and 03 (forced, fullscreen). ONE body: `forced` changes the
// copy and removes the decline, not the layout — which is why binding content to surface
// would have meant maintaining this twice.
@Composable
internal fun UpdateAvailableBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    val forced = p.bool("forced")
    TemplateColumn(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
        ) {
            Text(
                text = "⬆",
                modifier = Modifier.padding(16.dp),
                fontSize = 28.sp,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        TemplateTitle(
            if (forced) "Please update to continue" else "Update available",
            center = true,
        )
        TemplateBodyText(
            p.string("release_notes")
                ?: if (forced) {
                    "This version contains a required fix. Older versions can no longer connect."
                } else {
                    "A newer version is available with the latest improvements."
                },
            center = true,
        )
        p.string("current_version")?.let {
            Text(
                "Version $it",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        VSpace(4)
        PrimaryAction(if (forced) "Update now" else "Update") {
            a.onPrimary(ActionType.STORE.value, p.string("store_url"))
        }
        // A forced update offers NO way out. Rendering a decline the evaluator would ignore
        // would be a control that lies about what it does.
        if (!forced) SecondaryAction("Later", a.onSecondary)
    }
}

// ── policy_update ────────────────────────────────────────────────────────────
// Mockup 04. requires_ack, so there is no decline at all — the acknowledgement IS the action.
@Composable
internal fun PolicyUpdateBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn {
        Eyebrow("Policy update", MaterialTheme.colorScheme.tertiary)
        TemplateTitle(p.string("title", "Our terms are changing"))
        p.string("summary")?.let { TemplateBodyText(it) }
        p.string("effective_at")?.let {
            InsetCard {
                Text(
                    // Date only: nobody needs to know new terms begin at 00:00 exactly.
                    "Effective ${formatTimestamp(it, includeTime = false)}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        p.string("policy_url")?.let { url ->
            Text(
                text = "Read the full policy",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { a.onPrimary(ActionType.URL.value, url) },
            )
        }
        VSpace(4)
        PrimaryAction("I agree") { a.onPrimary(ActionType.ACKNOWLEDGE.value, null) }
    }
}

// ── paywall_upsell ───────────────────────────────────────────────────────────
// Mockup 05. Headline, benefit list, price, subscribe. The benefits array is the design.
@Composable
internal fun PaywallBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn {
        Eyebrow("Upgrade")
        TemplateTitle(p.string("headline", "Go further with Pro"))
        val benefits = p.strings("benefits")
        if (benefits.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                benefits.forEach { BulletRow(it) }
            }
        }
        p.string("price_text")?.let {
            InsetCard {
                Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
        }
        VSpace(4)
        PrimaryAction(p.string("cta_label", "Subscribe")) {
            parseCtaAction(p.string("cta_action"), fallback = ActionType.URL)
                .let { a.onPrimary(it.type.value, it.value) }
        }
        if (item.isDismissible) SecondaryAction("Maybe later", a.onSecondary)
    }
}

// ── incident_outage / information / maintenance / geo_notice / onboarding_tip ─
// Mockup 06. An inline strip, severity-toned, with a status link. Shares one body because the
// five schemas differ only in which optional field they add.
/**
 * Caution. Fixed rather than themed — see the severity mapping in [IncidentBody] for why.
 *
 * Chosen to clear WCAG AA against both a light and a dark surface at the size the banner uses;
 * a brighter amber does not, on white.
 */
private val WarningAmber = Color(0xFFB45309)

@Composable
internal fun IncidentBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    val severity = p.string("severity", "info")
    val tone = when (severity) {
        // `error` is the one severity Material gives a semantic role for, so it is themed.
        "critical", "major", "error" -> MaterialTheme.colorScheme.error
        // CAUTION AMBER, fixed — not `tertiary`.
        //
        // Material has no warning role, so this used to borrow `tertiary`. But tertiary carries
        // no meaning: a consumer can set it to anything, and the sample sets it to emerald — so
        // a "service degraded" banner rendered GREEN, signalling the opposite of what it said.
        // The SDK cannot signal severity with a colour whose meaning the host controls.
        //
        // Same reasoning as the rating stars: caution is a conventional signal and reads as
        // wrong in any other colour. The surrounding chrome stays themed; only the severity
        // indicator is pinned, because only it carries meaning the host must not redefine.
        "warning", "degraded" -> WarningAmber
        else -> MaterialTheme.colorScheme.primary
    }

    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Surface(
            modifier = Modifier.padding(end = 12.dp).size(32.dp),
            shape = RoundedCornerShape(8.dp),
            color = tone.copy(alpha = 0.14f),
        ) {
            Text(
                text = "!",
                modifier = Modifier.padding(top = 5.dp),
                color = tone,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
        Column(modifier = Modifier.fillMaxWidth(0.9f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    // From the SURFACE, not hardcoded. This body backs incident_outage,
                    // information, maintenance, geo_notice and onboarding_tip — and several of
                    // those templates allow `dialog` as well as `banner`. Pinned to titleSmall
                    // it rendered banner-sized type inside a dialog, which is how one body
                    // serving five templates quietly goes wrong on the less-used surface.
                    text = p.string("title", "Service notice"),
                    style = LocalDesign.titleStyle,
                    fontWeight = FontWeight.SemiBold,
                )
                Surface(
                    modifier = Modifier.padding(start = 8.dp).size(6.dp),
                    shape = CircleShape,
                    color = tone,
                ) {}
            }
            p.string("body")?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // Maintenance states a window; the design shows it inline rather than as a field.
            val start = p.string("window_start")
            val end = p.string("window_end")
            if (start != null && end != null) {
                Text(
                    formatWindow(start, end),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                )
            }
            p.string("status_url")?.let { url ->
                Text(
                    text = "Status page",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable { a.onPrimary(ActionType.URL.value, url) },
                )
            }
        }
    }
}

// ── survey_nps ───────────────────────────────────────────────────────────────
// Mockup 07. The 0..10 scale is the design — a generic body reduced this to a title and a
// button, which cannot collect a score at all.
@Composable
internal fun SurveyNpsBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    val min = p.int("scale_min", 0)
    val max = p.int("scale_max", 10)
    var selected by remember { mutableStateOf<Int?>(null) }

    TemplateColumn {
        Eyebrow("Feedback")
        TemplateTitle(p.string("question", "How likely are you to recommend us?"))
        p.string("follow_up")?.let { TemplateBodyText(it) }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("Not likely", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Extremely likely", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            (min..max).forEach { n ->
                val on = selected == n
                Surface(
                    modifier = Modifier
                        // weight, not a fixed size: an 0..10 scale is ELEVEN chips, and at a
                        // fixed 28.dp they overflowed the row and the 10 was clipped away —
                        // the one score the survey most needs to capture.
                        .weight(1f)
                        .height(30.dp)
                        .clickable { selected = n },
                    shape = RoundedCornerShape(6.dp),
                    color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = n.toString(),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }
        }

        VSpace(4)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedAction("Maybe later", Modifier.weight(1f), a.onSecondary)
            // Disabled until a score exists: submitting an empty NPS response would record a
            // row that means nothing and cannot be told apart from a real one.
            PrimaryAction("Send feedback", Modifier.weight(1.4f)) {
                selected?.let { a.onPrimary(ActionType.SUBMIT.value, it.toString()) }
            }
        }
    }
}

// ── whats_new ────────────────────────────────────────────────────────────────
// Mockup 08. A version plus an item list; the items ARE the content.
@Composable
internal fun WhatsNewBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn {
        Eyebrow("What's new")
        TemplateTitle(p.string("version")?.let { "Version $it" } ?: "What's new")
        val items = p.strings("items")
        if (items.isEmpty()) {
            TemplateBodyText("This release includes general improvements.")
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.forEach { BulletRow(it) }
            }
        }
        VSpace(4)
        PrimaryAction("Got it") { a.onPrimary(ActionType.DISMISS.value, null) }
    }
}

// ── promo_offer ──────────────────────────────────────────────────────────────
// Mockup 09. Headline, body, a copyable offer code, an expiry.
@Composable
internal fun PromoOfferBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn {
        Eyebrow("Offer", MaterialTheme.colorScheme.tertiary)
        TemplateTitle(p.string("headline", "A limited-time offer"))
        p.string("body")?.let { TemplateBodyText(it) }
        p.string("offer_code")?.let { code ->
            InsetCard {
                Column {
                    Text(
                        "Code",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(code, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
        p.string("expires_at")?.let {
            Text(
                "Expires ${formatTimestamp(it)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        VSpace(4)
        PrimaryAction(p.string("cta_label", "Claim offer")) {
            parseCtaAction(p.string("cta_action"), fallback = ActionType.URL)
                .let { a.onPrimary(it.type.value, it.value) }
        }
        if (item.isDismissible) SecondaryAction("No thanks", a.onSecondary)
    }
}

// ── rating_prompt ────────────────────────────────────────────────────────────
@Composable
internal fun RatingPromptBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn(horizontalAlignment = Alignment.CenterHorizontally) {
        // Icons, not the "★" character. A text glyph depends on whatever font the platform
        // falls back to, which is why this rendered in an off-palette weight that looked
        // broken rather than deliberate — and the fallback differs per platform, so the
        // surface was inconsistent across the targets this SDK ships to.
        //
        // The amber is fixed rather than themed. A star is a conventional signal and reads as
        // wrong in any other colour; the surrounding chrome stays themed.
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            repeat(5) {
                Icon(
                    imageVector = Icons.Filled.Star,
                    contentDescription = null,
                    tint = Color(0xFFF5A623),
                    modifier = Modifier.size(28.dp),
                )
            }
        }
        TemplateTitle(p.string("title", "Enjoying the app?"), center = true)
        p.string("body")?.let { TemplateBodyText(it, center = true) }
        VSpace(4)
        // REVIEW, not STORE. The two look similar and are not: STORE sends the user to a
        // listing, REVIEW shows the platform's own sheet over the app — which is the entire
        // reason the native APIs exist, and why a store link converts so much worse.
        //
        // `store_url` still travels as the value: it is the fallback for desktop and web,
        // which have no review API at all.
        PrimaryAction("Rate") { a.onPrimary(ActionType.REVIEW.value, p.string("store_url")) }
        if (item.isDismissible) SecondaryAction("Not now", a.onSecondary)
    }
}
