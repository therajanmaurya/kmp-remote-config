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

// NOTE: `cmp-observe` is NOT a module here. It stays published from MobileByteLabs/KmpToolkit
// and is consumed as `io.github.mobilebytelabs:cmp-observe` — vendoring a second copy of a
// published module is exactly the drift this split was meant to avoid.
