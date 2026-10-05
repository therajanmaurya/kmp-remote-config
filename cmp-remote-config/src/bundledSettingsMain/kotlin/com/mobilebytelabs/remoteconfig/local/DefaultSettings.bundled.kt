/*
 * Copyright 2026 MobileByteLabs · Apache 2.0
 */
package com.mobilebytelabs.remoteconfig.local

import com.russhwolf.settings.Settings

/** These targets have a platform-backed store, so multiplatform-settings' own factory is correct. */
internal actual fun defaultSettings(): Settings = Settings()
