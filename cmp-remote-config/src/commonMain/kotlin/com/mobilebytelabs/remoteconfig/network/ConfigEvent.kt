package com.mobilebytelabs.remoteconfig.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One reported interaction with a delivered config.
 *
 * `eventId` is client-generated and the server dedupes on it (ring-buffered, last 50 per
 * impression row). It must be unique PER EVENT, not per config: `dismiss` and `ack` are
 * idempotent state transitions, but `impression` increments a counter — a genuine second
 * showing must count twice while a network retry of the first must not. Deduping on
 * (config, device, type) instead would silently cap every config at one impression.
 */
@Serializable
data class ConfigEvent(
    @SerialName("event_id") val eventId: String,
    @SerialName("config_id") val configId: String,
    /** impression · dismiss · ack · action */
    val type: String,
    /** ISO-8601 UTC. */
    val at: String,
)

@Serializable
internal data class EventBatch(
    @SerialName("device_id") val deviceId: String,
    val events: List<ConfigEvent>,
)
