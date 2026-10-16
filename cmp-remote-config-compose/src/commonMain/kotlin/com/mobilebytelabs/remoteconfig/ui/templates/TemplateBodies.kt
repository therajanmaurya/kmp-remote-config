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
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Place
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
import com.mobilebytelabs.remoteconfig.model.DisplayType
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
        // UPDATE, not STORE. Play can download and install without the app leaving the
        // foreground, and a forced update becomes a flow the user cannot wander away from —
        // which a store link cannot promise, because they land on a listing and may simply
        // never press the button.
        //
        // `store_url` still travels as the value: it is the fallback everywhere in-app update
        // does not exist, which today is everywhere except Android.
        PrimaryAction(if (forced) "Update now" else "Update") {
            a.onPrimary(ActionType.UPDATE.value, p.string("store_url"))
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

// ─────────────────────────────────────────────────────────────────────────────
// The five templates that had no body of their own.
//
// Until 2026-10-16 the registry aliased `information`, `maintenance`, `geo_notice` and
// `onboarding_tip` to IncidentBody, and `notification` to AnnouncementBody. That is why an
// onboarding tip reached users as an amber outage warning: nobody chose it, the rows were
// simply pointed at the closest body that already existed. Mockups 10-15 are the first
// designs any of these five ever had.
//
// A note that applies to all of them: each renders ONLY what its template's payload_schema
// declares. The mockups elaborate past that — information draws a "Learn more" link,
// geo_notice and onboarding_tip draw an inset note card, onboarding_tip draws "Tip 2 of 3"
// step dots — and none of those fields exist in the schemas (migration 004). Rendering them
// would mean a control with nothing behind it, which is the dead-affordance class
// RULE-IMPL-DEAD-CLICKABLE-001 exists to stop. The schema gains the field first; the
// renderer follows. The divergence is deliberate and listed, not overlooked.
// ─────────────────────────────────────────────────────────────────────────────

// ── information ──────────────────────────────────────────────────────────────
// Mockup 10. The design's whole instruction is what it must NOT be: an outline info circle in
// the neutral accent, no illustration, no marketing register, and ONE action — informational
// copy carries no decision, so it must not offer a choice. Previously IncidentBody, which
// opened with the amber "!" chip built for an outage.
@Composable
internal fun InformationBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    // `severity` is the only tone input this schema declares, and it tops out at "warning" —
    // there is no `critical` here, unlike incident_outage. Migration 004 already defaults it
    // to "info", so the neutral branch is the one that normally runs.
    val tone = when (p.string("severity", "info")) {
        "warning" -> WarningAmber
        else -> MaterialTheme.colorScheme.primary
    }

    TemplateColumn {
        Surface(
            modifier = Modifier.size(32.dp),
            shape = RoundedCornerShape(8.dp),
            color = tone.copy(alpha = 0.14f),
        ) {
            Icon(
                imageVector = Icons.Filled.Info,
                contentDescription = null,
                tint = tone,
                modifier = Modifier.padding(6.dp),
            )
        }
        TemplateTitle(p.string("title", "A quick heads-up"))
        p.string("body")?.let { TemplateBodyText(it) }
        PrimaryAction("Got it") { a.onDismiss() }
    }
}

// ── notification ─────────────────────────────────────────────────────────────
// Mockup 11. Was AnnouncementBody, which is built to SELL a change — illustration, marketing
// tone. A notification reports something that already happened. The design is emphatic that it
// reads CALM and POSITIVE in the neutral accent, never the amber that belongs to
// incident_outage, because the two can appear in the same app minutes apart and the user has
// to tell them apart at a glance.
@Composable
internal fun NotificationBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    val tone = MaterialTheme.colorScheme.primary

    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Surface(
            modifier = Modifier.padding(end = 12.dp).size(32.dp),
            shape = RoundedCornerShape(8.dp),
            color = tone.copy(alpha = 0.14f),
        ) {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = tone,
                modifier = Modifier.padding(6.dp),
            )
        }
        Column(modifier = Modifier.fillMaxWidth(0.9f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = p.string("title", "Update"),
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
            // Unlike information's "Learn more", this link always has something behind it:
            // cta_label and cta_action are both REQUIRED by this template's schema.
            p.string("cta_label")?.let { label ->
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodySmall,
                    color = tone,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable {
                        parseCtaAction(p.string("cta_action"), fallback = ActionType.DEEPLINK)
                            .let { a.onPrimary(it.type.value, it.value) }
                    },
                )
            }
        }
    }
}

// ── maintenance ──────────────────────────────────────────────────────────────
// Mockup 13. The design is BLOCKING: no close, no back, no "Later" — the backend genuinely
// cannot serve, so an exit only returns the user to a broken app. "Try again" re-fetches
// rather than dismissing, which is the difference between this and every other body here.
//
// Distinct from incident_outage, whose body it used to borrow: that one is a banner over a
// still-working app, this one owns the screen. Sharing a renderer made a total outage look
// like a degraded-service notice.
@Composable
internal fun MaintenanceBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    val tone = MaterialTheme.colorScheme.primary

    // This template declares allowed_displays {fullscreen, banner} — two surfaces with opposite
    // shapes — so the body branches rather than pretending they are the same picture. A centred
    // 56dp icon over a full-width button is right for a takeover and far too heavy pinned under
    // a top bar; a compact row is right for a banner and looks lost on a full screen. Everything
    // below the branch is identical, so the two can never drift in CONTENT, only in density.
    if (item.display == DisplayType.BANNER.value) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Surface(
                modifier = Modifier.padding(end = 12.dp).size(32.dp),
                shape = RoundedCornerShape(8.dp),
                color = tone.copy(alpha = 0.14f),
            ) {
                Icon(
                    imageVector = Icons.Filled.Build,
                    contentDescription = null,
                    tint = tone,
                    modifier = Modifier.padding(6.dp),
                )
            }
            Column(modifier = Modifier.fillMaxWidth(0.9f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = p.string("title", "Back shortly"),
                    style = LocalDesign.titleStyle,
                    fontWeight = FontWeight.SemiBold,
                )
                p.string("body")?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                val bStart = p.string("window_start")
                val bEnd = p.string("window_end")
                if (bStart != null && bEnd != null) {
                    Text(
                        formatWindow(bStart, bEnd),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
        return
    }

    TemplateColumn(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            modifier = Modifier.size(56.dp),
            shape = CircleShape,
            color = tone.copy(alpha = 0.12f),
        ) {
            Icon(
                imageVector = Icons.Filled.Build,
                contentDescription = null,
                tint = tone,
                modifier = Modifier.padding(14.dp),
            )
        }
        TemplateTitle(p.string("title", "Back shortly"), center = true)
        p.string("body")?.let { TemplateBodyText(it, center = true) }

        // The window is the one fact that turns "something is wrong" into "it ends at a known
        // time", so it is shown rather than left to the body copy. formatWindow is the same
        // helper incident_outage uses, so the two render a window identically.
        val start = p.string("window_start")
        val end = p.string("window_end")
        if (start != null && end != null) {
            Text(
                formatWindow(start, end),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
            )
        }

        // NOT onDismiss. A dismiss here would close the only thing standing between the user
        // and an app that cannot load — the host re-fetches and decides whether the config
        // still applies. `item.isDismissible` is deliberately not consulted: the server-side
        // contract for this template is that it blocks.
        PrimaryAction("Try again") { a.onPrimary(ActionType.NONE.value, null) }
    }
}

// ── geo_notice ───────────────────────────────────────────────────────────────
// Mockup 14. The eyebrow carries the design's load-bearing idea: say WHO this applies to
// before the user reads a word of the body, because a regional notice shown to someone it does
// not cover is just confusing. Quiet legal register throughout — regional is not urgent, which
// is exactly what the borrowed amber IncidentBody got wrong.
@Composable
internal fun GeoNoticeBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    val regions = p.strings("regions")

    TemplateColumn {
        // Built from `regions`, the schema's own required field — so the chip can never state a
        // region the config was not actually targeted at.
        if (regions.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Filled.Place,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(14.dp).padding(end = 2.dp),
                )
                Eyebrow(regions.joinToString(" · "))
            }
        }
        TemplateTitle(p.string("title", "A note for your region"))
        p.string("body")?.let { TemplateBodyText(it) }
        PrimaryAction("Got it") { a.onDismiss() }
    }
}

// ── onboarding_tip ───────────────────────────────────────────────────────────
// Mockup 15. The lightest surface in the set — it teaches, so it must not feel like an
// interruption. That is the opposite of the amber incident banner it used to render as, which
// is about as interrupting as this SDK gets.
//
// "Skip tips" is the secondary on purpose: the design opts out of the whole sequence, not just
// this card, which is why it is not simply a dismiss.
@Composable
internal fun OnboardingTipBody(item: RemoteConfigItem, p: TemplatePayload, a: TemplateActions) {
    TemplateColumn {
        Eyebrow("Tip")
        TemplateTitle(p.string("title", "Did you know?"))
        p.string("body")?.let { TemplateBodyText(it) }
        PrimaryAction("Try it") { a.onDismiss() }
        if (item.isDismissible) SecondaryAction("Skip tips", a.onSecondary)
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
        // SELECTABLE, not decorative (reconciled to mockup 12, 2026-10-16).
        //
        // These five were previously always-filled and inert. Two things were wrong with that:
        // a row of five full stars reads as a rating ALREADY GIVEN, and it looked tappable
        // while doing nothing — the dead-affordance class. The design shows them unfilled and
        // filling as the user picks, with the choice echoed underneath.
        //
        // The rating is NOT sent anywhere, and that is deliberate rather than unfinished: no
        // store review API accepts a pre-set score, so claiming to submit one would be a lie
        // told to the user. What it buys is intent — the host's review sheet opens with the
        // person having already decided, instead of being ambushed by it.
        var rating by remember { mutableStateOf(0) }

        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            repeat(5) { i ->
                val filled = i < rating
                Icon(
                    imageVector = Icons.Filled.Star,
                    contentDescription = null,
                    // The amber is fixed rather than themed: a star is a conventional signal
                    // and reads as wrong in any other colour. Unselected borrows the theme's
                    // own low-emphasis outline so the row still sits inside the host's palette.
                    tint = if (filled) Color(0xFFF5A623) else MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier
                        .size(28.dp)
                        .clickable { rating = i + 1 },
                )
            }
        }
        TemplateTitle(p.string("title", "Enjoying the app?"), center = true)
        p.string("body")?.let { TemplateBodyText(it, center = true) }
        // Appears only once a score exists — the design's "5 stars · Loved it!" line. Before a
        // tap there is nothing truthful to say, so nothing is said.
        if (rating > 0) {
            Text(
                text = when (rating) {
                    5 -> "5 stars · Loved it!"
                    4 -> "4 stars · Liked it"
                    3 -> "3 stars · It was OK"
                    2 -> "2 stars · Needs work"
                    else -> "1 star · Sorry to hear it"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
