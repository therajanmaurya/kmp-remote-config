# kmp-remote-config

[![Maven Central](https://img.shields.io/maven-central/v/io.github.mobilebytelabs/cmp-remote-config?label=Maven%20Central&color=blue)](https://central.sonatype.com/artifact/io.github.mobilebytelabs/cmp-remote-config)
[![CI](https://github.com/MobileByteLabs/kmp-remote-config/actions/workflows/gradle.yml/badge.svg)](https://github.com/MobileByteLabs/kmp-remote-config/actions/workflows/gradle.yml)
[![Kotlin](https://img.shields.io/badge/kotlin-2.4.20-blue.svg?logo=kotlin)](http://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Server-driven remote config for **Kotlin Multiplatform** — change what your app shows without
shipping a release.

Point the SDK at a publishable key, drop one composable in your tree, and a dialog, bottom sheet,
banner or full-screen takeover renders from the server in your app's own Material theme:

```kotlin
RemoteConfigHost(screen = "home")
```

> ⚠️ **Status: pre-release.** This repo was split out of
> [KmpToolkit](https://github.com/MobileByteLabs/KmpToolkit) and the control plane is still being
> built. The code here is the KmpToolkit `3.5.28` lineage: the publishable-key, screen-filter and
> template work described below is **not implemented yet** — `RemoteConfigHost` takes no `screen`
> parameter and configuration still wants a Supabase URL + anon key.
>
> **`4.0.0-alpha01` is on Maven Central but was published by accident** (2026-10-05): this repo's
> genesis push matched the inherited publish trigger and released it unattended. It is the 3.5.28
> code under a 4.x version number. Do not read the version as a signal that the rework landed.
> See [Relationship to KmpToolkit](#relationship-to-kmptoolkit).

## What this is

Three pieces that ship as one product:

| Piece | Where | What it does |
|---|---|---|
| **SDK** | [`cmp-remote-config`](cmp-remote-config/) + [`cmp-remote-config-compose`](cmp-remote-config-compose/) | Fetch, evaluate, render. Headless core + Compose surface |
| **Backend** | [`supabase/`](supabase/) | Schema + Edge Functions: the key registry, targeting, templates, impressions |
| **Dashboard** | [`dashboard/`](dashboard/) | Operator UI (Next.js 14 → Cloudflare Pages) — author a config from a template form, target it, schedule it |

Why the SDK is two artifacts: the Compose compiler plugin applies to *every* compilation and fails
on any target without the Compose runtime on the class path. Splitting the renderer out is what lets
a server, CLI or watch complication evaluate a config at all.

## Modules

| Module | Artifact | Description | Latest |
|--------|----------|-------------|:------:|
| [cmp-remote-config](cmp-remote-config/) | `io.github.mobilebytelabs:cmp-remote-config` | Headless — fetch, evaluate, server-driven UI document model. 15 KMP targets | [![](https://img.shields.io/maven-central/v/io.github.mobilebytelabs/cmp-remote-config?label=%20)](https://central.sonatype.com/artifact/io.github.mobilebytelabs/cmp-remote-config) |
| [cmp-remote-config-compose](cmp-remote-config-compose/) | `io.github.mobilebytelabs:cmp-remote-config-compose` | `RemoteConfigHost` + dialog / bottom-sheet / banner / full-screen presentations, dynamic UI renderer, `Module.remoteConfig { }` Koin DSL. 7 Compose-MP targets | [![](https://img.shields.io/maven-central/v/io.github.mobilebytelabs/cmp-remote-config-compose?label=%20)](https://central.sonatype.com/artifact/io.github.mobilebytelabs/cmp-remote-config-compose) |

> **Target support:** [TARGET_MATRIX.md](TARGET_MATRIX.md) is the single source of truth for which
> KMP targets each module ships and why — measured, with JetBrains' tier list as the upstream
> reference.

## Installation

Both modules ship together at the unified `kmpremoteconfig.version`:

```toml
# gradle/libs.versions.toml
[versions]
kmpRemoteConfig = "LATEST"  # see the Maven Central badge above

[libraries]
cmp-remote-config         = { module = "io.github.mobilebytelabs:cmp-remote-config",         version.ref = "kmpRemoteConfig" }
cmp-remote-config-compose = { module = "io.github.mobilebytelabs:cmp-remote-config-compose", version.ref = "kmpRemoteConfig" }
```

`cmp-remote-config-compose` exposes the core types as `api`, so depending on it alone is enough to
use the whole library. Add the headless module directly only on a target with no renderer.

## Docs

📖 **[Docs site](https://mobilebytelabs.github.io/kmp-remote-config/)** · 🚀 **[Releases](https://github.com/MobileByteLabs/kmp-remote-config/releases)** · 📦 **[Maven Central](https://central.sonatype.com/artifact/io.github.mobilebytelabs/cmp-remote-config)**

Per-module API reference ships as Dokka HTML inside each `-javadoc.jar`, so IntelliJ and Android
Studio surface it in hover popups automatically.

- [docs/REMOTE_CONFIG.md](docs/REMOTE_CONFIG.md) — long-form guide
- [docs/remote-config/SETUP.md](docs/remote-config/SETUP.md) — manual integration
- [cmp-remote-config/DEVELOPMENT.md](cmp-remote-config/DEVELOPMENT.md) — module development state

## Relationship to KmpToolkit

These two modules lived in [KmpToolkit](https://github.com/MobileByteLabs/KmpToolkit) through
`3.5.28`. They moved here because remote config grew a server and a dashboard, which do not belong
in a general-purpose library collection.

The **artifact coordinates are deliberately unchanged** — a consumer migrates a *version*, not a
dependency id. Three things follow from that:

1. `4.0.0` is a major bump because the SDK's entry point changes:
   `remoteConfig { supabaseUrl; supabaseKey }` becomes a single `publishableKey`.
2. **Both repos can now publish the same coordinates**, which is the hazard this split needed to
   manage and did not. KmpToolkit should drop these two modules; until it does, it can still release
   `3.5.x` on them while this repo owns `4.x`. Central accepts both, so nothing errors — the versions
   just interleave across two sources.
3. `4.0.0-alpha01` was released from here unintentionally (see Status above). Central does not allow
   deletion, so the 4.x line starts at `-alpha02`.

Publishing is now gated: `publish.yml` has no cron schedules and fires only on a manual dispatch or
a push to the **`release`** branch. A push to `dev` cannot publish, whatever it touches.

`cmp-observe` is **not** vendored here — it stays published from KmpToolkit and is consumed as
`io.github.mobilebytelabs:cmp-observe`. A second copy of a published module would drift.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) · docs conventions in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
./gradlew build          # compile + test every target this host can build
./gradlew fix            # apply Spotless formatting
./gradlew detekt         # static analysis
./gradlew koverHtmlReport
```

## License

```
Copyright 2026 MobileByteLabs

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0
```

See [LICENSE](LICENSE) for details.
