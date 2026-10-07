package com.mobilebytelabs.remoteconfig.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The `GET /v1/configs` response.
 *
 * This is the SHIPPED wire model — `RemoteConfigEnvelopeTest` and `ContractFixtureTest` both
 * assert `contract/configs-response.json` against these types, and the Deno twin
 * (`supabase/functions/v1-configs/contract_test.ts`) asserts the same bytes against the
 * serializer that produces them. A commit that changes the response shape without changing
 * this file fails exactly one of the two.
 *
 * Replaces the KmpToolkit 3.5.28 model, which read a `product_remote_config` table directly
 * over PostgREST and carried flat `title` / `description` / `action_text` fields. That model
 * could not express templates, payload schemas or screen targeting, and the control plane
 * has never served it.
 */
@Serializable
data class RemoteConfigEnvelope(
    @SerialName("schema_version") val schemaVersion: Int = 1,
    val configs: List<RemoteConfigItem> = emptyList(),
    /**
     * Typed parameter values, already resolved for this caller's audience.
     *
     * A flat key → value map rather than a list of objects with their conditions attached:
     * the server has already decided which condition won, and shipping the predicates would
     * invite the client to re-decide and disagree. Defaulted to empty so an older server that
     * sends no `parameters` key keeps working.
     */
    val parameters: JsonObject = JsonObject(emptyMap()),
)

/**
 * One delivered config.
 *
 * Audience targeting (platform, app-version window, screens, schedule) is evaluated
 * SERVER-SIDE and is deliberately absent here: by the time a config reaches a device it has
 * already matched, and shipping the predicates would invite a second, divergent evaluation
 * on the client.
 */
@Serializable
data class RemoteConfigItem(
    val id: String = "",

    /**
     * The template id — the wire field is `template`, not `template_id`. Getting this wrong
     * is the drift `RemoteConfigEnvelopeTest` exists to catch.
     */
    val template: String = "",
    @SerialName("template_version") val templateVersion: Int = 1,

    /** One of dialog · bottom_sheet · banner · fullscreen · none (migration 010 closes the set). */
    val display: String = "none",

    /**
     * Opaque, validated server-side against the template's `payload_schema`.
     *
     * Deliberately a [JsonObject] rather than flattened named fields. Flattening is what
     * limited the old model to announcement-shaped configs: `update_available` carries
     * store_url / forced / release_notes / current_version and has no title or body at all,
     * so any fixed field set is wrong for most of the fifteen templates.
     */
    val payload: JsonObject = JsonObject(emptyMap()),

    val priority: Int = 0,
    @SerialName("renders_ui") val rendersUi: Boolean = true,
    @SerialName("requires_ack") val requiresAck: Boolean = false,
    val version: Int = 1,

    // Frequency controls. The server omits these for value-only configs, where they are
    // meaningless — hence defaults rather than required fields.
    @SerialName("is_dismissible") val isDismissible: Boolean = true,
    @SerialName("max_impressions") val maxImpressions: Int = 1,
    @SerialName("cooldown_hours") val cooldownHours: Int = 24,
)
