/*
 * Copyright 2026 MobileByteLabs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */
import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.KotlinMultiplatform
import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.roborazzi)
    alias(libs.plugins.vanniktech.mavenPublish)
    alias(libs.plugins.binaryCompatibilityValidator)
    id("io.github.mobilebytelabs.remoteconfig.dokka")
    id("io.github.mobilebytelabs.remoteconfig.kover")
}

// ============================================================================
// LIBRARY CONFIGURATION — cmp-remote-config-compose
// ============================================================================
// The Compose surface of cmp-remote-config: RemoteConfigHost + the banner / dialog /
// bottom-sheet / full-screen presentations, the Coil-backed DynamicUiRenderer, the
// RemoteConfigViewModel, and the `Module.remoteConfig { }` Koin DSL that wires them.
//
// WHY THIS MODULE EXISTS (E2, 2026-09-12)
// cmp-remote-config used to carry all of this in `commonMain`, which pinned the whole
// library to the 7 Compose-Multiplatform targets — so a server or CLI could not evaluate
// a flag without dragging material3, navigation-compose and Coil along. 12 of its 20
// files needed none of that.
//
// The split could NOT be done with an intermediate source set inside one module, which
// was tried first: the Compose compiler plugin applies to EVERY compilation and fails
// with "The Compose Compiler requires the Compose Runtime to be on the class path" on any
// target that does not have the runtime. That is the structural reason this toolkit ships
// X / X-compose pairs rather than one module with a Compose source set, and it is why
// cmp-share, cmp-firebase, cmp-network-monitor, cmp-intent-launcher and cmp-app-intents
// are all shaped this way.
//
// Targets are the 7 Compose-Multiplatform ones. iosX64 / macosX64 are absent because
// Compose 1.12.0 publishes no artifact for either — measured, not assumed.
// ============================================================================
group = "io.github.mobilebytelabs"
version = providers.gradleProperty("kmpremoteconfig.version").get()

@OptIn(ExperimentalKotlinGradlePluginApi::class, ExperimentalWasmDsl::class)
kotlin {
    applyDefaultHierarchyTemplate()

    jvm()

    android {
        namespace = "com.mobilebytelabs.remoteconfig.compose"
        compileSdk =
            libs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        withJava()
        withHostTestBuilder {}.configure {
            isReturnDefaultValues = true
            isIncludeAndroidResources = true
        }
        withDeviceTestBuilder { sourceSetTreeName = "test" }
        compilerOptions {
            jvmTarget = JvmTarget.JVM_11
        }
        androidResources.enable = true
    }

    iosArm64()
    iosSimulatorArm64()

    macosArm64()

    js {
        browser()
        nodejs()
    }

    wasmJs { browser() }

    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    sourceSets {
        commonMain.dependencies {
            // ConfigContent and the template bodies read the opaque JSON payload, so these
            // types are part of this module's surface too — see the note in cmp-remote-config.
            api(libs.kotlinx.serialization.json)
            // `api`, not `implementation`: this module's public surface takes and returns core
            // types (RemoteConfig, UiNode, ActionType), so a consumer must see them — and it keeps
            // a single `cmp-remote-config-compose` dependency sufficient to use the whole library.
            api(project(":cmp-remote-config"))

            // Compose
            implementation(compose.material3)
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.ui)
            implementation(compose.materialIconsExtended)

            // DI — koin-core is `implementation` in the core module, so it is not visible
            // transitively; the `Module.remoteConfig { }` receiver needs it at compile time here.
            implementation(libs.koin.core)
            implementation(libs.koin.compose.viewmodel)

            // Navigation
            implementation(libs.navigation.compose)

            // Lifecycle
            implementation(libs.lifecycle.viewmodel.compose)
            implementation(libs.androidx.lifecycle.runtime.compose)

            // Image loading — DynamicUiRenderer renders server-supplied image nodes.
            implementation(libs.coil.compose)
            implementation(libs.coil.network.ktor)

            // Logging — the moved ActionDispatcher logs unhandled action types.
            implementation(libs.kermit)

            // multiplatform-settings — `singleOf(::RemoteConfigLocalStore)` resolves that constructor,
            // whose parameter type is `Settings`; the core module declares it `implementation`, so it
            // is not visible transitively.
            implementation(libs.multiplatform.settings)

            // Coroutines
            implementation(libs.kotlinx.coroutines.core)
        }

        commonTest.dependencies {
            implementation(libs.kotlin.test)
            // The DSL test drives the wiring Koin actually produces, which needs an engine.
            implementation(libs.ktor.client.mock)
            implementation(libs.kotlinx.coroutines.test)
        }

        // Golden-image tests for the nine designed template bodies. JVM-only on purpose:
        // Roborazzi renders through Compose Desktop, and a golden rendered once is a golden
        // that holds for every target, because the bodies live in commonMain and share one
        // composition. Running them per-platform would compare the same tree against itself.
        jvmTest.dependencies {
            implementation(libs.kotlin.test)
            @OptIn(org.jetbrains.compose.ExperimentalComposeLibrary::class)
            implementation(compose.uiTest)
            implementation(compose.desktop.currentOs)
            implementation(libs.roborazzi.compose.desktop)
        }
    }
}

// ============================================================================
// MAVEN CENTRAL PUBLISHING
// ============================================================================
mavenPublishing {
    configure(
        KotlinMultiplatform(
            javadocJar = JavadocJar.Dokka("dokkaGeneratePublicationHtml"),
            sourcesJar = true,
        ),
    )
    signAllPublications()

    pom {
        name = "CMP Remote Config Compose"
        description =
            "Compose Multiplatform surface for cmp-remote-config — RemoteConfigHost, banner / dialog / " +
            "bottom-sheet / full-screen presentations, the Coil-backed dynamic UI renderer and the " +
            "Module.remoteConfig { } Koin DSL. Add alongside cmp-remote-config to render server-driven UI."
        inceptionYear = "2026"
        url = "https://github.com/MobileByteLabs/kmp-remote-config/"
        licenses {
            license {
                name = "The Apache License, Version 2.0"
                url = "https://www.apache.org/licenses/LICENSE-2.0.txt"
                distribution = "repo"
            }
        }
        developers {
            developer {
                id = "MobileByteLabs"
                name = "MobileByteLabs"
                url = "https://github.com/MobileByteLabs"
            }
        }
        scm {
            url = "https://github.com/MobileByteLabs/kmp-remote-config/"
            connection = "scm:git:git://github.com/MobileByteLabs/kmp-remote-config.git"
            developerConnection = "scm:git:ssh://git@github.com/MobileByteLabs/kmp-remote-config.git"
        }
    }
}

// Library Runtime Observability — auto-generate CmpMetadata.kt for cmp-observe hooks
apply(from = "$rootDir/cmp-observe-metadata.gradle.kts")
