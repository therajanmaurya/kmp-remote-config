/*
 * Copyright 2026 MobileByteLabs · Apache 2.0
 */
package com.mobilebytelabs.remoteconfig.local

import com.russhwolf.settings.Settings

/**
 * linuxX64 / mingwX64 — multiplatform-settings declares no `Settings()` factory here because there
 * is no OS preference store to bind to. See [InMemorySettings] for why this degrades rather than
 * throwing.
 */
internal actual fun defaultSettings(): Settings = InMemorySettings()
