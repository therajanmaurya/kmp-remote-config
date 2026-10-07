/*
 * Copyright 2026 MobileByteLabs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// ============================================================================
// SAMPLE — com.mobilebytesensei.rconfig
// ============================================================================
// A Kotlin Multiplatform app that integrates the SDK exactly as the onboarding wizard
// instructs, so the documented path is one that has actually been compiled.
//
// NOT published (no vanniktech plugin, absent from CMP_LIBRARY_METADATA) — it is a consumer,
// and publishing it would put a sample on Maven Central beside the library.
//
// Targets are deliberately a SUBSET: jvm proves the integration on a desktop target that runs
// in CI with no emulator or simulator. Adding android/ios here would make the sample the
// slowest module in the build while proving the same commonMain wiring.
kotlin {
    jvm()

    jvmToolchain(17)

    compilerOptions {
        jvmToolchain(17)
    }

    sourceSets {
        commonMain.dependencies {
            // The two artefacts the dashboard's integration snippet names. Project
            // dependencies rather than coordinates: the sample must break when the SDK
            // changes under it, which is the only reason to keep a sample in-repo.
            implementation(project(":cmp-remote-config"))
            implementation(project(":cmp-remote-config-compose"))

            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)

            implementation(libs.ktor.client.core)
            implementation(libs.kotlinx.coroutines.core)
        }

        jvmMain.dependencies {
            implementation(compose.desktop.currentOs)
            implementation(libs.ktor.client.cio)
        }

        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
    }
}
