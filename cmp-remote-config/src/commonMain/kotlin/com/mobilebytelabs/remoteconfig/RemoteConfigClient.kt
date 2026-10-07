package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Reads typed parameter values.
 *
 * Two sources, in order: the values the server resolved for this device, then the IN-APP
 * DEFAULTS the host app compiled in. The defaults are not a nicety — on a first launch with
 * no network there is no server value for anything, and a getter that returned null or false
 * there would leave every flag-gated feature silently off for every new install until a fetch
 * landed. Firebase makes the same choice for the same reason.
 *
 * Nothing here throws. A type mismatch between what the dashboard holds and what the app asks
 * for is an operator mistake or a parameter whose type changed between releases; crashing a
 * host app over a config value is never the right trade, so a mismatch falls back exactly as
 * an absent key does.
 */
class RemoteConfigClient(
    private val defaults: JsonObject = JsonObject(emptyMap()),
) {
    private var served: JsonObject = JsonObject(emptyMap())

    /** Take the parameters from a successful fetch. Configs are handled by the evaluator. */
    fun accept(envelope: RemoteConfigEnvelope) {
        served = envelope.parameters
    }

    /**
     * Resolve a key through server → default, trying the NEXT source when one holds a value
     * of the wrong shape. Reading `theme` as a boolean must not return null merely because
     * the server has a string for it, when the app shipped a boolean default.
     */
    private fun <T> read(key: String, extract: (JsonPrimitive) -> T?): T? {
        for (source in listOf(served, defaults)) {
            val prim = source[key] as? JsonPrimitive ?: continue
            extract(prim)?.let { return it }
        }
        return null
    }

    fun getString(key: String): String? = read(key) { if (it.isString) it.content else null }

    fun getBoolean(key: String): Boolean? = read(key) { it.booleanOrNull }

    fun getLong(key: String): Long? = read(key) { it.longOrNull }

    fun getDouble(key: String): Double? = read(key) { it.doubleOrNull }

    /** Objects and arrays are returned whole — the caller knows their own shape. */
    fun getJson(key: String): JsonObject? =
        (served[key] as? JsonObject) ?: (defaults[key] as? JsonObject)
}
