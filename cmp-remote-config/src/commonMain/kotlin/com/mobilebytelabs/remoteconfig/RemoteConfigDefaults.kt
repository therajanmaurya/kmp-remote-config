package com.mobilebytelabs.remoteconfig

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Builds the bundled defaults a consumer compiles into their app.
 *
 * A typed builder rather than asking consumers to construct a `JsonObject`: the defaults are
 * the first thing anyone integrating this library writes, and making that step require
 * kotlinx-serialization's DSL puts a serialization concept in front of a configuration task.
 * It also keeps the declared type visible at the call site, which is where a mismatch with
 * the dashboard's parameter type is cheapest to notice.
 *
 * ```
 * val defaults = remoteConfigDefaults {
 *     boolean("welcome_banner_enabled", false)
 *     long("max_uploads", 5)
 *     string("theme", "light")
 * }
 * ```
 */
fun remoteConfigDefaults(build: RemoteConfigDefaultsBuilder.() -> Unit): JsonObject =
    RemoteConfigDefaultsBuilder().apply(build).build()

class RemoteConfigDefaultsBuilder internal constructor() {
    private val values = mutableMapOf<String, JsonElement>()

    fun string(key: String, value: String) { values[key] = JsonPrimitive(value) }
    fun boolean(key: String, value: Boolean) { values[key] = JsonPrimitive(value) }
    fun long(key: String, value: Long) { values[key] = JsonPrimitive(value) }
    fun double(key: String, value: Double) { values[key] = JsonPrimitive(value) }

    /** For a `json`-typed parameter, whose shape only the consumer knows. */
    fun json(key: String, value: JsonObject) { values[key] = value }

    internal fun build(): JsonObject = JsonObject(values.toMap())
}
