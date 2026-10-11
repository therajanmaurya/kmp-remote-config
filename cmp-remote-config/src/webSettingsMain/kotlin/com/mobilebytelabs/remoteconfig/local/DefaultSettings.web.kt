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

import co.touchlab.kermit.Logger
import com.russhwolf.settings.Settings

private const val TAG = "DefaultSettings"

/**
 * js / wasmJs — `Settings()` where there may or may not be a browser around it.
 *
 * Unlike the other two flavours, this one cannot be decided at compile time. `Settings()` IS
 * declared for these targets, and in a browser it is the right answer: it returns a
 * `StorageSettings` over `localStorage`, and impression caps and cooldowns persist across
 * reloads exactly as they should.
 *
 * The problem is that the same compiled artifact also runs where no browser exists — Node, SSR,
 * a prerender pass, `jsNodeTest`. `StorageSettings`' no-delegate branch reads the bare identifier
 * `localStorage`, which in Node is not `undefined` but *undeclared*, so evaluating it throws a
 * `ReferenceError` **while the object is being constructed**. That timing is what made this worth
 * a source set: the failure lands inside `defaultSettings()`, which runs as the default argument
 * of `RemoteConfigLocalStore` / `DeviceIdProvider`, which Koin builds eagerly when
 * `remoteConfig { }` installs. A browser-only global therefore took down SDK initialisation
 * itself, not just persistence — the host could not construct the module at all.
 *
 * So: try the real store, and degrade to [InMemorySettings] when the environment has none. The
 * same bargain documented on [InMemorySettings] — flags evaluate correctly for the life of the
 * process and forget on restart — which is precisely right for a server-side render that will not
 * outlive the request anyway.
 *
 * Deliberately NOT folded into `bundledSettingsMain`. On android / jvm / apple a throwing
 * `Settings()` means something is actually wrong (no `Context`, an unwritable prefs directory),
 * and swallowing it there would turn a loud startup failure into a store that silently stops
 * surviving restarts — so those targets keep the unguarded factory.
 */
internal actual fun defaultSettings(): Settings = runCatching { Settings() }
    .getOrElse {
        // Not a warning. In Node this is the expected, correct outcome, and the only hosts
        // that reach it are the ones with nowhere to persist to.
        Logger.d(TAG) { "no web storage (${it::class.simpleName}) — using in-memory settings" }
        InMemorySettings()
    }
