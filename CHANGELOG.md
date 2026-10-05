# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **History before this file:** `cmp-remote-config` and `cmp-remote-config-compose` lived in
> [KmpToolkit](https://github.com/MobileByteLabs/KmpToolkit) through `3.5.28`. Entries for every
> release up to and including that version are in
> [KmpToolkit's CHANGELOG](https://github.com/MobileByteLabs/KmpToolkit/blob/dev/CHANGELOG.md).
> This file starts at the split.

---

## [Unreleased] — `4.0.0-alpha01`

### Added — repo split from KmpToolkit

Remote config moved to its own repo because it grew a server and an operator dashboard, which do not
belong in a general-purpose library collection. The repo carries three pieces as one product: the
SDK (`cmp-remote-config` + `cmp-remote-config-compose`), the backend (`supabase/`) and the dashboard
(`dashboard/`).

Carried over unchanged from KmpToolkit: the Gradle publishing pipeline, Dokka/Kover convention
plugins, detekt + Spotless config, the mkdocs site, and the CI workflows.

### Changed

- **Artifact coordinates are unchanged** — `io.github.mobilebytelabs:cmp-remote-config` and
  `…:cmp-remote-config-compose`. A consumer migrates a *version*, not a dependency id.
- `cmp-observe` is now an **external dependency** (`io.github.mobilebytelabs:cmp-observe:3.5.31`)
  rather than a sibling module. It stays published from KmpToolkit; vendoring a second copy would
  drift.
- Single version source renamed `kmptoolkit.version` → `kmpremoteconfig.version`.
- Convention plugin ids renamed `io.github.mobilebytelabs.kmptoolkit.{dokka,kover}` →
  `io.github.mobilebytelabs.remoteconfig.{dokka,kover}`.
- Default branch is `dev`; there is no `main`.

### Fixed — two defects inherited from KmpToolkit

- **`CmpMetadata.VERSION` was always `"UNKNOWN"`.** `cmp-observe-metadata.gradle.kts` is applied
  from each module's `build.gradle.kts`, so its `apply(from = CMP_LIBRARY_METADATA.gradle.kts)` ran
  in the *module's* context and populated the module's `extra` — but the lookup read
  `rootProject.extra`, which never had the keys, so every module fell through to the `"UNKNOWN"`
  fallback. The symptom was visible in `cmp-remote-config/DEVELOPMENT.md` (`version: UNKNOWN`) but
  read as "not published yet". Now reads `extra` first, with `rootProject.extra` as fallback.
  **Still present in KmpToolkit for all its modules.**
- **`cmp-remote-config`'s Android namespace was `com.mobilebytesensei.featurerequest`** — a
  copy-paste from cmp-product-tickets. Corrected to `com.mobilebytelabs.remoteconfig`.
- `CMP_LIBRARY_METADATA.gradle.kts` had no `cmp_remote_config_compose_version` key at all; both
  modules now declare both keys.

### Not yet implemented

The product this split exists for — a hosted control plane, publishable keys bound by platform
attestation (Play Integrity / App Attest), screen-scoped targeting, a server-side template registry
(`update_available`, `notification`, …) and the operator dashboard — is **not in this release**. The
SDK still behaves as it did at `3.5.28`: `remoteConfig { supabaseUrl; supabaseKey }` talks directly
to a consumer-supplied Supabase project with an anon key.

`4.0.0` is reserved as a major because that entry point becomes a single `publishableKey`.

### Precondition before the first publish

KmpToolkit must **stop publishing** `cmp-remote-config` and `cmp-remote-config-compose`, or two
repos race the same Maven coordinate.
