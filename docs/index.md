---
title: "kmp-remote-config"
description: "Server-driven remote config for Kotlin Multiplatform — render dialogs, bottom sheets and banners from the server in your app's own Material theme, targeted by screen, platform and app version."
---

# kmp-remote-config

!!! abstract "Change what your app shows without shipping a release"
    Point the SDK at a publishable key, drop one composable in your tree, and a dialog,
    bottom sheet, banner or full-screen takeover renders from the server — in your app's
    own Material theme. Two artifacts, aligned on a single `kmpremoteconfig.version`,
    published to Maven Central at `io.github.mobilebytelabs:*`.

```kotlin
RemoteConfigHost(screen = "home")
```

!!! warning "Pre-release — `4.0.0-alpha01`"
    This repo was split out of [KmpToolkit](https://github.com/MobileByteLabs/KmpToolkit)
    at `3.5.28` and the control plane is still being built. The SDK here behaves as it did
    in KmpToolkit: it talks directly to a consumer-supplied Supabase project with an anon
    key. Publishable keys, attestation, screen-scoped targeting and the template registry
    are **not implemented yet**.

## Quick links

- [Getting started](getting-started.md) — install + Koin wiring + first-screen example
- [cmp-remote-config](modules/cmp-remote-config.md) — module landing page
- [Observability cookbook](cookbook/observability/index.md) — registering lifecycle hooks
- [GitHub](https://github.com/MobileByteLabs/kmp-remote-config) — source code

## Modules

| Module | Role | Targets |
|---|---|---|
| [cmp-remote-config](modules/cmp-remote-config.md) | Headless — fetch, evaluate, server-driven UI document model | 15 |
| `cmp-remote-config-compose` | `RemoteConfigHost` + dialog / bottom-sheet / banner / full-screen presentations, dynamic UI renderer, `Module.remoteConfig { }` Koin DSL | 7 (Compose-MP) |

The split exists because the Compose compiler plugin applies to *every* compilation and fails on any
target without the Compose runtime on the class path. Keeping the renderer in its own artifact is
what lets a server, CLI or watch complication evaluate a config at all.

`cmp-remote-config-compose` exposes the core types as `api`, so depending on it alone is enough to
use the whole library.

## API reference

!!! info "Dokka HTML lives inside `-javadoc.jar`"
    Each module ships its full Dokka HTML reference inside the Maven
    Central `-javadoc.jar` artifact. IntelliJ / Android Studio surfaces
    it automatically in hover popups, Quick Documentation, and Symbol
    search.

    For an offline copy: download a module's `*-javadoc.jar`, rename to
    `.zip`, and open `index.html`.
