/*
 * Copyright 2026 MobileByteLabs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */
package com.mobilebytelabs.remoteconfig.local

import com.russhwolf.settings.ExperimentalSettingsApi
import com.russhwolf.settings.Settings

/**
 * The [Settings] instance used when a caller does not supply one.
 *
 * Exists because `Settings()` — multiplatform-settings' no-arg factory — is NOT declared for every
 * target this module now builds. It was fine while the module was pinned to the 7 Compose targets;
 * adding linuxX64 and mingwX64 made `RemoteConfigLocalStore(settings: Settings = Settings())`
 * unresolvable in `commonMain`, which is what blocked the E2 split.
 *
 * Kept `internal` and used only as a default argument, so the public constructor signatures are
 * byte-identical to before — a consumer passing their own [Settings] is unaffected, and so is the
 * BCV baseline.
 */
internal expect fun defaultSettings(): Settings

/**
 * Process-lifetime [Settings] for targets with no platform-provided store (linuxX64, mingwX64).
 *
 * A deliberate, documented degradation rather than a no-op or a crash: impression counts and
 * cooldowns work correctly *within* a run, which is what a server or CLI evaluating flags in one
 * process actually needs, and they simply do not survive a restart. A host that needs persistence
 * passes its own [Settings] — the constructor parameter exists precisely for that.
 */
@OptIn(ExperimentalSettingsApi::class)
internal class InMemorySettings : Settings {
    private val values: MutableMap<String, Any> = mutableMapOf()

    override val keys: Set<String> get() = values.keys
    override val size: Int get() = values.size

    override fun clear() = values.clear()

    override fun remove(key: String) {
        values.remove(key)
    }

    override fun hasKey(key: String): Boolean = values.containsKey(key)

    override fun putInt(key: String, value: Int) {
        values[key] = value
    }

    override fun getInt(key: String, defaultValue: Int): Int = values[key] as? Int ?: defaultValue

    override fun getIntOrNull(key: String): Int? = values[key] as? Int

    override fun putLong(key: String, value: Long) {
        values[key] = value
    }

    override fun getLong(key: String, defaultValue: Long): Long = values[key] as? Long ?: defaultValue

    override fun getLongOrNull(key: String): Long? = values[key] as? Long

    override fun putString(key: String, value: String) {
        values[key] = value
    }

    override fun getString(key: String, defaultValue: String): String = values[key] as? String ?: defaultValue

    override fun getStringOrNull(key: String): String? = values[key] as? String

    override fun putFloat(key: String, value: Float) {
        values[key] = value
    }

    override fun getFloat(key: String, defaultValue: Float): Float = values[key] as? Float ?: defaultValue

    override fun getFloatOrNull(key: String): Float? = values[key] as? Float

    override fun putDouble(key: String, value: Double) {
        values[key] = value
    }

    override fun getDouble(key: String, defaultValue: Double): Double = values[key] as? Double ?: defaultValue

    override fun getDoubleOrNull(key: String): Double? = values[key] as? Double

    override fun putBoolean(key: String, value: Boolean) {
        values[key] = value
    }

    override fun getBoolean(key: String, defaultValue: Boolean): Boolean = values[key] as? Boolean ?: defaultValue

    override fun getBooleanOrNull(key: String): Boolean? = values[key] as? Boolean
}
