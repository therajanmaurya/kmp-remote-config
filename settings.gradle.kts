pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "kmp-remote-config"

// ── SDK ────────────────────────────────────────────────────────────────────────
// Headless core + its Compose surface. The pair is split (rather than one module with a
// Compose source set) because the Compose compiler plugin applies to EVERY compilation and
// fails on any target without the Compose runtime on the class path — so a server, CLI or
// watch complication can evaluate a config only if the renderer is a separate artifact.
include(":cmp-remote-config")
include(":cmp-remote-config-compose")

// ── Sample ─────────────────────────────────────────────────────────────────────
// A consumer of the two artefacts above, integrating them the way the dashboard's onboarding
// snippet tells an operator to. It exists so that path is compiled rather than asserted, and
// it depends on the PROJECTS rather than published coordinates so it breaks when the SDK does.
include(":sample")

// The SAME SDK with no Compose anywhere: depends only on :cmp-remote-config and applies
// neither Compose plugin, on targets Compose does not publish for (linux, mingw, watchOS,
// tvOS). If the headless core ever gained a Compose dependency this module would stop
// compiling — a guarantee no test of the library's own source can give.
include(":sample-headless")

// ── Sample app shells ──────────────────────────────────────────────────────────
// One per platform, as the Kotlin Multiplatform wizard lays it out: `:sample` holds the shared
// `App()` and the integration, and each module below is a thin entry point around it. The split
// is not ceremony — an Android application and a Compose Desktop distribution are different
// artefacts with different plugins, and a single module cannot be both.
include(":sampleAndroidApp")
include(":sampleDesktopApp")
include(":sampleWebApp")

// NOTE: `cmp-observe` is NOT a module here. It stays published from MobileByteLabs/KmpToolkit
// and is consumed as `io.github.mobilebytelabs:cmp-observe` — vendoring a second copy of a
// published module is exactly the drift this split was meant to avoid.
