/*
 * Copyright 2026 MobileByteLabs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */
import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi

plugins {
    alias(libs.plugins.kotlinMultiplatform)
}

// ============================================================================
// SAMPLE (HEADLESS) — the SDK with NO Compose anywhere
// ============================================================================
// The counterpart to `:sample`. This module applies NEITHER Compose plugin and depends ONLY on
// `:cmp-remote-config`, so if the headless core ever acquired a Compose dependency this module
// would stop compiling — which is the guarantee it exists to provide, and one no test of the
// library's own source could give.
//
// Targets deliberately include the places Compose cannot go: linuxX64 and mingwX64 (a server or
// a CLI), watchosArm64 (a complication), tvosArm64. A config can be EVALUATED on all of them;
// only rendering needs the Compose artefact.
@OptIn(ExperimentalKotlinGradlePluginApi::class)
kotlin {
    applyDefaultHierarchyTemplate()

    jvm()

    linuxX64()
    mingwX64()

    // Compose Multiplatform publishes nothing for these, which is precisely the point.
    watchosArm64()
    tvosArm64()

    sourceSets {
        commonMain.dependencies {
            // ONE dependency. No `:cmp-remote-config-compose`, no Compose runtime.
            implementation(project(":cmp-remote-config"))
            implementation(libs.ktor.client.core)
            implementation(libs.kotlinx.coroutines.core)
        }

        commonTest.dependencies {
            implementation(libs.kotlin.test)
            // MockEngine so the contract tests need no real engine — pulling a platform engine
            // into this module would weaken the very claim it exists to make.
            implementation(libs.ktor.client.mock)
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}
