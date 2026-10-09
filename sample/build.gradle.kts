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
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

// ============================================================================
// SAMPLE — com.mobilebytesensei.rconfig (Compose Multiplatform)
// ============================================================================
// A Compose Multiplatform app integrating the SDK exactly as the onboarding wizard instructs,
// so the documented path is one that has been COMPILED rather than merely written down.
//
// Targets mirror `cmp-remote-config-compose` — the renderer's reach is the ceiling for any app
// that renders. The HEADLESS half of the SDK goes further (15 targets: server, watchOS, tvOS,
// linux, mingw), and `sample-headless` exists to prove that half independently. Together the
// two samples demonstrate the split the library is built around: a config can be EVALUATED
// anywhere, and RENDERED wherever Compose runs.
//
// NOT published — it is a consumer. Publishing a sample beside the library would put an app on
// Maven Central.
@OptIn(ExperimentalKotlinGradlePluginApi::class, ExperimentalWasmDsl::class)
kotlin {
    // Toolchain 21, not just jvmTarget 21.
    //
    // `jvmTarget` controls the bytecode we EMIT; it says nothing about the JDK that RUNS the
    // tests. Gradle here launches on JDK 17, so with target-only the suite still failed with
    // UnsupportedClassVersionError the moment it touched KmpToolkit's Java-21 classes — the
    // exact error the raise was meant to remove. Declaring the toolchain makes the compile and
    // test JVMs explicit instead of inheriting whatever JDK started the daemon.
    jvmToolchain(21)

    applyDefaultHierarchyTemplate()

    jvm()

    android {
        namespace = "com.mobilebytesensei.rconfig"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()
        // Matches the library modules; see the note in cmp-remote-config/build.gradle.kts.
        compilerOptions { jvmTarget = JvmTarget.JVM_21 }
    }

    // A framework, not bare targets. `iosArm64()` alone compiles Kotlin and produces a klib,
    // which is why `:sample:compileKotlinIosSimulatorArm64` passed for months while there was
    // nothing an Xcode project could link against — `embedAndSignAppleFrameworkForXcode` is
    // registered by the `binaries.framework` declaration, so without this block the build
    // phase every iOS integration guide tells you to add refers to a task that does not exist.
    //
    // Static because that is what the Compose Multiplatform wizard emits and what the SDK's
    // consumers will therefore have: a dynamic framework needs signing on every embed, and the
    // sample should not be the one place that deviates.
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "sample"
            isStatic = true
        }
    }

    wasmJs { browser() }

    sourceSets {
        commonMain.dependencies {
            // The two artefacts the dashboard's integration snippet names. PROJECT
            // dependencies, not coordinates: the sample must break when the SDK changes under
            // it, which is the only reason to keep a sample in the repo at all.
            implementation(project(":cmp-remote-config"))
            implementation(project(":cmp-remote-config-compose"))

            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)

            implementation(libs.ktor.client.core)
            implementation(libs.kotlinx.coroutines.core)

            // RemoteConfigHost resolves its ViewModel from Koin, so a host app that renders
            // configs wires Koin. The headless sample shows the path that does not.
            implementation(libs.koin.core)
            implementation(libs.koin.compose.viewmodel)
        }

        jvmMain.dependencies {
            implementation(compose.desktop.currentOs)
            implementation(libs.ktor.client.cio)
        }

        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }

        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }

        wasmJsMain.dependencies {
            implementation(libs.ktor.client.js)
        }

        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
    }
}

// `./gradlew :sample:run` opens the desktop window. The sample is a CONSUMER, so this is the
// only place it behaves like an app rather than a library.
compose.desktop {
    application {
        mainClass = "com.mobilebytesensei.rconfig.MainKt"
    }
}
