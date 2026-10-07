import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.KotlinMultiplatform
import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinxSerialization)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.vanniktech.mavenPublish)
    id("io.github.mobilebytelabs.remoteconfig.dokka")
    id("io.github.mobilebytelabs.remoteconfig.kover")
    alias(libs.plugins.binaryCompatibilityValidator)
}

group = "io.github.mobilebytelabs"
version = providers.gradleProperty("kmpremoteconfig.version").get()

@OptIn(ExperimentalKotlinGradlePluginApi::class)
kotlin {
    applyDefaultHierarchyTemplate()

    android {
        namespace = "com.mobilebytelabs.remoteconfig"
        compileSdk =
            libs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()

        withJava()

        withHostTestBuilder {}.configure {}

        withDeviceTestBuilder {
            sourceSetTreeName = "test"
        }

        compilerOptions {
            jvmTarget = JvmTarget.JVM_11
        }
        androidResources.enable = true
    }

    iosArm64()
    iosSimulatorArm64()

    macosArm64()

    // Headless families, added by E2 (2026-09-12) once the Compose surface moved to
    // cmp-remote-config-compose. This is the point of the split: a server, a CLI or a watch
    // complication can now evaluate a flag without a renderer on the class path.
    //
    // ABSENT, measured rather than assumed:
    //   iosX64 / macosX64            — Compose 1.12.0 publishes no artifact (they would be fine
    //                                  here, but cmp-remote-config-compose could not follow).
    //   watchosArm32 / watchosDeviceArm64 / linuxArm64
    //                                — `postgrest-kt` 3.2.6 publishes no artifact for exactly
    //                                  these three. It DOES publish for linuxX64, mingwX64, tvOS
    //                                  and the remaining watchOS archs, which is why they are here.
    //   wasmWasi                     — koin-core has no wasmWasi artifact (the same gap that made
    //                                  `koinMain` necessary elsewhere in this toolkit).
    watchosX64()
    watchosArm64()
    watchosSimulatorArm64()

    tvosX64()
    tvosArm64()
    tvosSimulatorArm64()

    linuxX64()
    mingwX64()

    jvm()

    js {
        browser()
        nodejs()
    }

    @OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
    wasmJs {
        browser()
    }

    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    sourceSets {
        // `Settings()` (multiplatform-settings' no-arg factory) is not declared for every target
        // this module now builds, so the default argument on RemoteConfigLocalStore /
        // DeviceIdProvider is supplied per platform via `defaultSettings()`. Two flavours only:
        // a platform-backed store where one exists, an in-memory one where the OS has none.
        val bundledSettingsMain = create("bundledSettingsMain").apply { dependsOn(getByName("commonMain")) }
        // `Settings()` with no arguments lives in multiplatform-settings-NO-ARG, a separate
        // artifact. It used to arrive transitively through supabase-postgrest; deleting the
        // Supabase transport in the 5.0.0 migration removed it and this source set stopped
        // compiling. Declared explicitly now — relying on a transport dependency to supply a
        // storage factory was never intentional.
        bundledSettingsMain.dependencies { implementation(libs.multiplatform.settings.no.arg) }
        listOf("androidMain", "jvmMain", "jsMain", "wasmJsMain", "appleMain").forEach {
            getByName(it).dependsOn(bundledSettingsMain)
        }

        val inMemorySettingsMain = create("inMemorySettingsMain").apply { dependsOn(getByName("commonMain")) }
        listOf("linuxMain", "mingwMain").forEach { getByName(it).dependsOn(inMemorySettingsMain) }

        // HEADLESS. Every Compose-bound dependency moved to cmp-remote-config-compose along with
        // the code that used it — material3 / runtime / foundation / ui / materialIconsExtended,
        // navigation-compose, the two lifecycle-compose artifacts, koin-compose-viewmodel and the
        // two Coil artifacts. What is left resolves for all 15 targets.
        commonMain.dependencies {

            // Reports this library's lifecycle to hooks the consumer registered. Pure stdlib since
            // the Firebase hooks moved to cmp-observe-firebase — 2 classpath lines, no transitive SDK.
            implementation(libs.cmp.observe)
            // HTTP transport to the rconfig control plane (/v1/configs, /v1/events).
            // supabase-postgrest was removed in the 5.0.0 migration: the SDK no longer talks
            // to a consumer's Supabase project directly. The HttpClient is INJECTED, so this
            // module pulls no platform engine of its own and stays testable with MockEngine.
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.serialization.kotlinx.json)

            // Serialization — `api`, NOT `implementation`.
            //
            // The public surface exposes kotlinx-serialization types: `remoteConfigDefaults`
            // returns a JsonObject, `RemoteConfigItem.payload` IS one, and the typed getters
            // take and return them. With `implementation` those types are absent from a
            // consumer's compile classpath and the integration the onboarding wizard prints
            // does not compile — which is exactly what the sample module hit on its first
            // build. A dependency that appears in your API is part of your API.
            api(libs.kotlinx.serialization.json)

            // DI
            implementation(libs.koin.core)

            // Logging
            implementation(libs.kermit)

            // Local storage
            implementation(libs.multiplatform.settings)

            // Coroutines
            implementation(libs.kotlinx.coroutines.core)
        }

        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.ktor.client.mock)
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}

mavenPublishing {
    // Bundle Dokka v2 HTML output inside -javadoc.jar so consumers browsing
    // Maven Central artifacts get real API docs rather than an empty jar.
    // Task name is the Dokka v2 ID; the DokkaConventionPlugin in build-logic
    // registers it via `org.jetbrains.dokka` + DokkaExtension.
    configure(
        KotlinMultiplatform(
            javadocJar = JavadocJar.Dokka("dokkaGeneratePublicationHtml"),
            sourcesJar = true,
        ),
    )
    signAllPublications()

    pom {
        name = "CMP Remote Config"
        description = "Cross-platform remote config and messaging module for KMP apps"
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
                id = "therajanmaurya"
                name = "Rajan Maurya"
                url = "https://github.com/therajanmaurya"
            }
        }

        scm {
            url = "https://github.com/MobileByteLabs/kmp-remote-config/"
            connection = "scm:git:git://github.com/MobileByteLabs/kmp-remote-config.git"
            developerConnection = "scm:git:ssh://git@github.com/MobileByteLabs/kmp-remote-config.git"
        }
    }
}

// Library Runtime Observability — auto-generate CmpMetadata.kt for cmp-observe hooks (epic 2026-05-30)
apply(from = "$rootDir/cmp-observe-metadata.gradle.kts")
