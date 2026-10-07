package com.mobilebytelabs.remoteconfig.ui.templates

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Typed reads over a template's payload.
 *
 * Every accessor tolerates a missing or wrongly-typed field and returns a fallback, because the
 * payload is authored in a dashboard and validated by a JSON-schema the DEVICE never sees. A
 * renderer that threw on a missing `title` would turn an operator's typo into a crash in the
 * host app — the one outcome a remote-config SDK must never produce. A missing field renders as
 * absent instead, which is visible, recoverable, and honest about what arrived.
 */
internal class TemplatePayload(private val json: JsonObject) {

    fun string(key: String): String? =
        (json[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }

    fun string(key: String, fallback: String): String = string(key) ?: fallback

    fun bool(key: String, fallback: Boolean = false): Boolean =
        (json[key] as? JsonPrimitive)?.booleanOrNull ?: fallback

    fun int(key: String, fallback: Int): Int =
        (json[key] as? JsonPrimitive)?.intOrNull ?: fallback

    /** String arrays — `benefits`, `items`, `regions`. Non-string entries are skipped, not fatal. */
    fun strings(key: String): List<String> =
        (json[key] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            ?.filter { it.isNotBlank() }
            ?: emptyList()
}
