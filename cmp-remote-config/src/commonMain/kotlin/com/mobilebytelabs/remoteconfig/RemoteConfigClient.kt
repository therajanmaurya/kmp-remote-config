package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import com.mobilebytelabs.remoteconfig.model.SdkSettings
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
    private var cached: JsonObject = JsonObject(emptyMap())
    private var settings: SdkSettings = SdkSettings()

    /** Take the parameters and settings from a successful fetch. Configs go to the evaluator. */
    fun accept(envelope: RemoteConfigEnvelope) {
        served = envelope.parameters
        settings = envelope.settings
    }

    /**
     * Restore settings from the local cache at startup, BEFORE the first fetch.
     *
     * This is what makes the kill switch real. An operator flips `enabled = false` precisely
     * when the SDK is misbehaving or the server is struggling — the moment a fetch is least
     * likely to succeed. A switch the client can only learn by fetching is decoration.
     */
    fun acceptSettings(restored: SdkSettings) {
        settings = restored
    }

    /**
     * Restore the last successfully fetched parameters from disk at startup.
     *
     * Sits BETWEEN the server and the bundled defaults. Without this layer, any offline launch
     * after the first would silently revert the user to shipping-day behaviour the moment
     * wifi dropped — a flag turned on weeks ago would appear to turn itself off.
     */
    fun acceptCached(restored: JsonObject) {
        cached = restored
    }

    /** The effective settings: whatever was last served or restored from cache. */
    fun settings(): SdkSettings = settings

    /**
     * Whether to fetch now.
     *
     * Order matters: the kill switch is checked FIRST, so a disabled app makes no request
     * regardless of how long it has been. A null [lastFetchAtMs] means this install has never
     * fetched — the interval has nothing to measure from, and waiting an hour before the first
     * fetch would make a cold install useless.
     */
    fun shouldFetch(lastFetchAtMs: Long?, nowMs: Long): Boolean {
        if (!settings.enabled) return false
        if (lastFetchAtMs == null) return true
        val effective = maxOf(settings.fetchIntervalSeconds, SdkSettings.MIN_FETCH_INTERVAL_SECONDS)
        return nowMs - lastFetchAtMs >= effective * 1000L
    }

    /**
     * Resolve a key through server → default, trying the NEXT source when one holds a value
     * of the wrong shape. Reading `theme` as a boolean must not return null merely because
     * the server has a string for it, when the app shipped a boolean default.
     */
    private fun <T> read(key: String, extract: (JsonPrimitive) -> T?): T? {
        for (source in listOf(served, cached, defaults)) {
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
        (served[key] as? JsonObject)
            ?: (cached[key] as? JsonObject)
            ?: (defaults[key] as? JsonObject)
}
