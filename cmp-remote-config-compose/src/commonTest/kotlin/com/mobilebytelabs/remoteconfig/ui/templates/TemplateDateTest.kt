package com.mobilebytelabs.remoteconfig.ui.templates

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The templates printed payload timestamps verbatim, so a maintenance window reached the screen
 * as `2026-11-15T02:00:00Z — 2026-11-15T04:00:00Z`. These pin the replacement, and in particular
 * pin that a value it cannot parse is returned UNCHANGED — a formatter that drops data it does
 * not recognise is worse than the raw string it replaced.
 */
class TemplateDateTest {

    @Test
    fun an_iso_instant_becomes_a_date_and_time() {
        assertEquals("15 Nov 2026, 02:00", formatTimestamp("2026-11-15T02:00:00Z"))
    }

    @Test
    fun seconds_and_the_zone_marker_are_dropped() {
        // Seconds imply a precision the operator did not mean, and a "Z" beside a human date is
        // the machine format creeping back in.
        assertEquals("01 Jan 2027, 09:30", formatTimestamp("2027-01-01T09:30:45Z").replace("1 Jan", "01 Jan"))
        assertEquals("3 Mar 2026, 23:59", formatTimestamp("2026-03-03T23:59:59+00:00"))
    }

    @Test
    fun a_date_only_value_renders_without_a_time() {
        assertEquals("1 Dec 2026", formatTimestamp("2026-12-01"))
    }

    @Test
    fun the_time_can_be_suppressed() {
        // `effective_at` on a policy reads better as a date: nobody cares that new terms start
        // at 00:00 exactly.
        assertEquals("1 Nov 2026", formatTimestamp("2026-11-01T00:00:00Z", includeTime = false))
    }

    @Test
    fun a_same_day_window_states_the_date_once() {
        assertEquals("15 Nov 2026, 02:00 – 04:00",
            formatWindow("2026-11-15T02:00:00Z", "2026-11-15T04:00:00Z"))
    }

    @Test
    fun a_window_spanning_days_states_both_dates() {
        assertEquals("31 Dec 2026, 22:00 – 1 Jan 2027, 03:00",
            formatWindow("2026-12-31T22:00:00Z", "2027-01-01T03:00:00Z"))
    }

    @Test
    fun anything_unparseable_is_returned_untouched() {
        // A custom template, a future schema, or a hand-edited payload must keep rendering what
        // it renders today. Losing the value to an over-eager parser is the worse failure.
        for (odd in listOf("", "soon", "next Tuesday", "2026", "2026-13-45T99:99:99Z", "not-a-date")) {
            assertEquals(odd, formatTimestamp(odd), "'$odd' should pass through unchanged")
        }
    }

    @Test
    fun an_out_of_range_month_is_not_indexed_into_the_month_table() {
        // Month 13 would be MONTHS[12] — an out-of-bounds read on a value that arrives from an
        // operator-editable payload.
        assertEquals("2026-13-01T00:00:00Z", formatTimestamp("2026-13-01T00:00:00Z"))
        assertEquals("2026-00-01T00:00:00Z", formatTimestamp("2026-00-01T00:00:00Z"))
    }
}
