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

## [Unreleased] — `4.0.0-alpha02`

### Changed — publishing is gated; cron releases removed

`publish-trigger.yml` fired on every push to `dev` matching `cmp-*/**`, and `publish.yml` carried two
cron schedules. It now dispatches only from a push to the **`release`** branch or a manual
`workflow_dispatch`, and the crons are gone. Also fixed in the same pass:

- `artifact-id` was `cmp-bubble` — a module this repo does not contain — so the "fail if Maven is
  ahead" guard compared our version against an unrelated artifact and could never catch a real
  collision. Now `cmp-remote-config`.
- `publish-gradle-plugin-portal: true` → `false`. No module here declares a `gradlePlugin` block
  (`cmp-firebase-gradle-plugin` stayed in KmpToolkit), so the job reported success having published
  nothing — a false green on the release summary.
- `bump-after-release: true` → `false`. `next-bump-type: 'patch'` turned `4.0.0-alpha01` into
  `4.0.1`, dropping the prerelease suffix and silently promoting the alpha line to a release line.
  Suffixes are now chosen by hand.
- The version path filter now includes `gradle.properties`. It previously did not, so a release
  commit that ONLY bumped the version would not have triggered — the inverse bug.

`SONATYPE_AUTOMATIC_RELEASE` stays `true`: a release is hands-off once it reaches `release`, so the
trigger is the only gate.

---

## [4.0.0-alpha01] — 2026-10-05 — released unintentionally

Published to Maven Central by accident. The genesis commit's push to `dev` matched
`publish-trigger.yml`'s then-current `cmp-*/**` path filter, which dispatched `publish.yml`;
org-level publishing secrets resolved via `secrets: inherit`, and `SONATYPE_AUTOMATIC_RELEASE=true`
closed and released the staging repository with no human gate. Maven Central does not permit
deletion, so the release is permanent.

**What it contains:** the functional KmpToolkit `3.5.28` code at a 4.x version number. The reworked
API the 4.x line is reserved for — publishable keys, attestation, `screen` scoping, the template
registry — is **not** in it. `remoteConfig { }` still requires `supabaseUrl` + `supabaseKey`, and
`RemoteConfigHost` still takes no `screen` parameter.

**If you depended on it:** prefer `3.5.x` from KmpToolkit for now, or pin `4.0.0-alpha01` knowingly.
It is not broken — it is mislabelled.

Tag `v4.0.0-alpha01` and its GitHub release were created by the same run.

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

### Coordinate ownership — still open

This was written as a precondition to be met *before* the first publish from here. The accidental
`4.0.0-alpha01` release overtook it, so it is now an open item rather than a gate:

KmpToolkit should **drop** `cmp-remote-config` and `cmp-remote-config-compose`. Until it does, both
repos can publish the same coordinates. Nothing errors — KmpToolkit releases `3.5.x`, this repo owns
`4.x`, and Central accepts both — but the version history for those artifacts interleaves across two
sources, and the two could collide the moment KmpToolkit's line reaches `4.0.0`.
