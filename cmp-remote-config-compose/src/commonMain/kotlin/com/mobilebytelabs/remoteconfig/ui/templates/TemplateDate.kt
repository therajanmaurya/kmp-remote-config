package com.mobilebytelabs.remoteconfig.ui.templates

/**
 * Render an ISO-8601 timestamp as something a person reads.
 *
 * The templates were printing payload timestamps verbatim, so a maintenance window appeared on
 * screen as:
 *
 *     2026-11-15T02:00:00Z — 2026-11-15T04:00:00Z
 *
 * That is a machine format in a user-facing surface. It is the single clearest tell that a UI
 * was never looked at — the content is correct and the presentation says nobody checked.
 *
 * ── Why hand-written rather than kotlinx-datetime ────────────────────────────────────────────
 * The input is always ISO-8601 UTC, produced by the control plane's `timestamptz` columns — the
 * payload schemas declare these as `string` and the dashboard writes them from Postgres. Parsing
 * a known fixed-width shape needs no dependency, and adding one to a UI module to reformat
 * twenty characters would be the wrong trade for every consumer who then carries it.
 *
 * This deliberately does NOT localise month names. The payload text around it is operator-authored
 * English, so an English month abbreviation is consistent with its surroundings; a half-localised
 * surface reads worse than a consistently English one. When the templates gain real i18n this
 * moves with them.
 *
 * ── Failure is never worse than today ────────────────────────────────────────────────────────
 * Anything unparseable returns UNCHANGED. A custom template, a future schema, or a hand-edited
 * payload keeps rendering exactly what it renders now rather than losing the value to a parser
 * that got clever.
 */
private val MONTHS = arrayOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

internal fun formatTimestamp(raw: String, includeTime: Boolean = true): String {
    // 2026-11-15T02:00:00Z  ·  2026-11-15T02:00:00+00:00  ·  2026-11-15
    val date = raw.substringBefore('T')
    val parts = date.split('-')
    if (parts.size != 3) return raw

    val year = parts[0].toIntOrNull() ?: return raw
    val month = parts[1].toIntOrNull() ?: return raw
    val day = parts[2].toIntOrNull() ?: return raw
    if (month !in 1..12 || day !in 1..31) return raw

    val head = "$day ${MONTHS[month - 1]} $year"
    if (!includeTime || !raw.contains('T')) return head

    // HH:mm only. Seconds in a user-facing window implies a precision the operator did not mean,
    // and the offset is dropped because every control-plane timestamp is UTC — printing "Z" next
    // to a human date just reintroduces the machine format in miniature.
    val time = raw.substringAfter('T').take(5)
    return if (time.length == 5 && time[2] == ':') "$head, $time" else head
}

/** A window rendered as one phrase, collapsing the date when both ends fall on the same day. */
internal fun formatWindow(start: String, end: String): String {
    val sameDay = start.substringBefore('T') == end.substringBefore('T')
    return if (sameDay) {
        // "15 Nov 2026, 02:00 – 04:00" rather than repeating the date twice.
        "${formatTimestamp(start)} – ${end.substringAfter('T').take(5)}"
    } else {
        "${formatTimestamp(start)} – ${formatTimestamp(end)}"
    }
}
