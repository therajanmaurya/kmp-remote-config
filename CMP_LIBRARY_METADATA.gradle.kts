// Library metadata consumed by CmpMetadataGenTask in cmp-observe-metadata.gradle.kts, which
// reads these `extra["..."]` properties at configure time to generate each module's
// CmpMetadata.kt (the identity cmp-observe stamps on every lifecycle event).
//
// Scope: ONLY the modules this repo publishes. In KmpToolkit this file enumerated all 23
// cmp-* artifacts and was regenerated post-publish by mbl-actionhub's emit-cmp-metadata.yml.
// Here the set is two, so it is hand-maintained — an entry for a module that does not exist
// is not harmless: the generator looks keys up with `as String` and a stale key silently
// stamps a wrong artifact id onto telemetry.
//
// Add a row only when settings.gradle.kts gains an `include(":cmp-…")`.

// Umbrella version — single source of truth is gradle.properties.
val libraryVersion = providers.gradleProperty("kmpremoteconfig.version").orElse("UNKNOWN").get()

extra["cmp_remote_config_version"] = libraryVersion
extra["cmp_remote_config_artifact"] = "io.github.mobilebytelabs:cmp-remote-config"

extra["cmp_remote_config_compose_version"] = libraryVersion
extra["cmp_remote_config_compose_artifact"] = "io.github.mobilebytelabs:cmp-remote-config-compose"
