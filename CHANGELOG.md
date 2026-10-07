# Changelog

## Unreleased — epic rconfig-sdk-control-plane-migration

### Phase 01 · T2 — transport rewrite (breaking)

- `RemoteConfigService` now calls the control plane's `GET /v1-configs` and `POST /v1-events`
  over an INJECTED Ktor `HttpClient`, replacing the 3.5.28 implementation that built a Supabase
  client from a consumer-supplied url + anon key and read the `product_remote_config` table over
  PostgREST. That table is not what the control plane serves, so the dashboard could not reach
  any device — this is the defect the epic exists to fix.
- **Breaking:** `supabaseUrl` / `supabaseKey` are gone from the Koin DSL. A consumer now supplies
  `publishableKey`, `packageName`, `platform`, `appVersion`, an optional Android `certDigest`,
  and an `HttpClient`. `baseUrl` defaults to the hosted control plane.
- A fetch now returns a three-state `ConfigFetchResult`: `Success` (configs may legitimately be
  empty), `Rejected` (the server refused this caller — `key_invalid`, `package_mismatch`,
  `rate_limited`, …), or `Unavailable` (transport failure; keep serving cache). The old code
  caught every exception and returned `emptyList()`, so a revoked key and "nothing to show" were
  indistinguishable to an integrator.
- `X-RC-SDK-Version` is always sent and never blank: the server answers 403 `sdk_version_missing`
  rather than an empty set, so a missing header blacks out the whole product. The value resolves
  defensively — `cmpMetadata()` reaches into an external artifact and anything it throws would
  otherwise propagate out of every fetch.
- Error logs carry the exception CLASS only, never the message: a transport error can echo the
  URL, and the URL carries the publishable key's package context.
- `RemoteConfigEvaluator` got SMALLER on purpose. It no longer re-checks `is_enabled`, schedule,
  app-version window or platform — the control plane evaluates all four server-side, so a config
  that arrives has already matched. Two implementations of the same rules would drift, and the
  client's copy loses: it cannot see screens, cohorts or rollout buckets at all. What remains is
  what only the device knows — impression caps, dismissal, cooldown.
- `multiplatform-settings-no-arg` is now declared explicitly. It had been arriving transitively
  through supabase-postgrest, so removing the old transport broke an unrelated source set.

### Phase 01 · T3 — unknown displays are skipped, not mis-rendered

- `DisplayType.from()` returns `null` for an unrecognized `display` instead of falling back to
  `DIALOG`; `RemoteConfigHost` renders nothing. Closes two cases: `display: "none"` (a value-only
  feature flag could have shown a modal) and any presentation the control plane adds later, which
  reaches an older SDK as an unknown string. The client half of migration 010's display closure.
- `RemoteConfigHost` no longer routes to the server-driven-document renderer. `/v1/configs` serves
  `template` + `payload` and carries no `content_json`, so that branch had no data source. The
  public `DynamicUiRenderer` / `UiNodeParser` API is unchanged — a consumer holding its own
  `UiDocument` still renders it; the Host simply no longer has one to pass.
- New `ConfigContent` derives each presentation's strings and its primary action's destination
  from the opaque payload BY ROLE, with per-template defaults. Reading `payload.title` directly
  renders an empty overlay for most of the fifteen builtins — `update_available` has no title at
  all, which is why it now falls back to "Update available".

### Phase 01 · T4 — the contract test asserts the shipped model

- `ContractFixtureTest` now deserializes `contract/configs-response.json` into the production
  `RemoteConfigEnvelope`. It previously used private `WireEnvelope` / `WireConfig` classes that
  existed only inside that file, so a commit could change the wire shape and those two classes
  together, pass both halves of the contract test, and leave the real SDK reading something else.
  That is the drift that let the dashboard and the device disagree. The `slice-3` marker is gone.
- Every wire field is asserted BY VALUE, deliberately: the shipped model defaults each field so an
  older client tolerates a newer server, which means a renamed key deserializes silently into its
  default rather than throwing. Proven by mutation — renaming `template` to `templateId` fails both
  this test and the inlined-fixture drift check; restoring it passes.

### Phase 06 — parameters + conditions UI (T1), device preview (T2)

- **Parameters UI** at `/apps/[id]/parameters`: typed list with the default and override count,
  plus a per-parameter editor for conditional overrides shown as an ordered "if CONDITION then
  VALUE" list. Three phases of server capability had no screens at all.
- **Conditions UI** at `/apps/[id]/conditions`, with the column that matters most: **used by N
  parameters**. A named condition only earns its name if you can see what it affects, and that
  count is Phase 03's reuse property made visible. Deleting one names the consequence — it
  cascades to every override using it.
- Predicates render in plain language ("platform is android and app ≥ 4.0.0"), not as raw JSON.
  Showing the object would make every condition look alike at a glance, which is the one thing a
  reusable-condition list cannot afford.
- An empty predicate reads "matches everyone" explicitly, because a blank cell would look like
  "not configured yet" when it means the opposite.
- **G-8c — constraint violations reach the operator as advice, not as constraint names.** A
  duplicate priority says which number collided and that lower wins; a boolean default of "yes" is
  refused in the form before it reaches the CHECK; a bad key shape says lower_snake_case. Six
  assertions in `__tests__/parameter-errors.test.ts`, each also asserting the raw constraint name
  does NOT survive into the message.
- Changing a parameter's type resets its default to a valid example rather than leaving a value the
  CHECK will reject — a type picker changing the default is less surprising than a save failing for
  a field the operator never touched.
- The override form suggests the next free priority, so the UNIQUE constraint is rarely met at all.

### Phase 06 (earlier) — device preview + the staged-diff regression

- **Fixed: a rollout change staged nothing.** `getPublishStatus` compared template/payload/display/
  priority but not `rollout_percentage` or `cohort`, so an operator could take a config from 10% to
  100% — the most consequential single edit in this product — and the dashboard would report no
  pending changes. Exactly the class of silent change Phase 02 exists to prevent, reintroduced by
  Phase 05. Now locked by `__tests__/publish-status.test.ts`: reverting the fix fails precisely the
  rollout and cohort assertions and nothing else.
- **Device preview** at `/apps/[id]/preview` — "what would this device receive right now", which
  GOAL.md names the single most useful operator tool and which did not exist. The audience lives in
  the query string, so a preview is a LINK: an operator reporting "iOS 4.2 users see nothing" can
  paste a URL that reproduces it rather than describing which boxes they filled in. The device id
  is editable because it decides rollout membership.
- **The preview IMPORTS the edge function's own `audience.ts` and `rollout.ts`** rather than
  reimplementing them, and reads the published snapshot exactly as `/v1/configs` does. A preview
  built as a second evaluator drifts silently, and an operator trusting a wrong preview is worse off
  than one with no preview at all.
- **G-8b proven against the real deployment**: `preview-parity.test.ts` runs the dashboard's
  resolver against prod and compares with what the deployed function serves for the same audience —
  byte-identical configs and parameters. Wired into `e2e_sdk_contract.sh`, which requires the run to
  REPORT a pass: jest exits 0 for a skipped test as readily as a passing one, so the exit code alone
  could not tell them apart, and a parity check that silently skips is a gate that reports green
  while asserting nothing.
- An empty preview says WHY it is empty — never published, or published but nothing in vN matches
  this audience. An empty result with no explanation reads as a broken page.

### Phase 05 — staged percentage rollout (migration 014)

- `rollout_percentage` (default 100) and `cohort` on `config`. Defaulting to 100 matters: a 0
  default would make every newly authored config invisible to everyone, which reads as "the
  product is broken" rather than as deliberate staging.
- **Bucketing is `hash(config_id:device_id) % 100 < percentage`, and the percentage is NEVER part
  of the hash input.** Both failure modes this avoids look like product bugs rather than config
  bugs, which is what makes them expensive: a per-fetch random draw re-rolls every poll so a
  device flickers in and out continuously, and mixing the percentage into the hash reshuffles the
  population so raising 10% to 20% DROPS some of the original 10% while adding others — with
  totals that still look right.
- Proven on the DEPLOYED function with real requests across 40 device ids: 0% reaches nobody, 100%
  reaches everybody, 50% reaches roughly half, and raising 50% to 75% drops nobody (G-7c). Seven
  further properties are asserted in `rollout_test.ts` against the shipped implementation,
  including an even distribution — a clumping hash would make a 10% rollout reach 2% or 40% while
  every stability property still held.
- FNV-1a, not `crypto.subtle` (async, would push an await into the per-config filter) and not a
  character-sum (clumps badly on UUIDs).
- **A caller with no `X-RC-Device` is EXCLUDED from a partial rollout, never included.** The
  alternative turns "10%" into "10% plus everyone we cannot identify", which is unbounded. 100%
  still reaches them, because 100% means everyone.
- **Caching adapts to the rollout.** With nothing staged the response carries no device identity
  and stays shared at the edge for 60s. The moment any config is partially rolled out the response
  becomes device-specific, so caching is dropped for those responses only — a shared cache would
  hand one device's rollout membership to every other device behind that entry.
- The SDK sends `X-RC-Device` on fetch; `deviceId` is nullable because a missing id must make a
  rollout reach fewer devices, never more.
- Dashboard: a rollout slider and cohort field on the authoring form, with a plain-language note
  that raising only adds devices. **`rollout_percentage` and `cohort` are compared in the staged
  diff** — omitting them would let an operator take a config from 10% to 100% with the dashboard
  reporting nothing pending, the single most consequential edit in the product, invisible.
- Rollout changes publish through the Phase 02 gate like any other edit: `publish()` snapshots with
  `to_jsonb(c)`, so the new columns travel into every version with no change to the routine.

### Phase 04 — SDK settings, the kill switch, and in-app defaults (migration 013)

- `app_settings` (one row per app, `app_id` as PRIMARY KEY) rides in the `/v1/configs` envelope:
  `enabled`, `fetch_interval_seconds`, `cache_ttl_seconds`, `max_retries`, `backoff_base_seconds`.
  The fetch interval was previously a compile-time constant in the consumer app, so a server under
  load could not ask clients to back off and a misbehaving integration could not be disabled
  without shipping a release through two review queues.
- **The kill switch works OFFLINE.** `acceptSettings()` restores cached settings at startup and
  `shouldFetch()` checks `enabled` FIRST. An operator flips the switch precisely when the SDK is
  misbehaving or the server is struggling — the moment a fetch is least likely to succeed — so a
  switch the client could only learn by fetching would be decoration.
- **Bounds live in the DATABASE, not the dashboard form.** `fetch_interval_seconds` is CHECKed to
  60..86400. A 1-second row would reach every device and then could not be withdrawn faster than
  the interval it just set. The ceiling matters too: a 90-day interval is indistinguishable from
  the SDK being off, except that it looks like a working configuration. An API caller bypasses the
  form; it cannot bypass a CHECK.
- **The client keeps its own floor** (`MIN_FETCH_INTERVAL_SECONDS = 60`) on top of those bounds,
  because this SDK also talks to self-hosted planes and to rows written before the CHECK existed.
  A compiled-in floor cannot be withdrawn by the thing it protects against.
- Every app gets a settings row from a trigger on creation, and existing apps were backfilled. An
  absent row would force the edge function to decide whether "no settings" means defaults or means
  disabled — ambiguity that ends with a kill switch read as "off" for an app nobody touched. Both
  the function and the SDK treat a missing row/block as "SDK defaults", never as disabled.
- **Three-layer precedence: `server > cache > bundled default`**, each covering a distinct moment.
  Bundled is all that exists on a first launch with no network — without it a brand-new install
  shows nothing, strictly worse than having no remote config, since the app was built assuming the
  values are there. Cache covers every later offline launch; falling past it would revert a user to
  shipping-day behaviour the moment wifi dropped. A key the server stops sending falls back rather
  than stranding a value the dashboard no longer has.
- `remoteConfigDefaults { boolean(...); long(...); string(...) }` — a typed builder, so the first
  thing an integrator writes does not require kotlinx-serialization's DSL, and the declared type
  stays visible where a mismatch with the dashboard is cheapest to notice.
- A first launch fetches immediately: with no last-fetch timestamp the interval has nothing to
  measure from, and waiting an hour would make a cold install useless.
- Verified live (14/14): settings ride in the envelope, a new app's row exists and is enabled, and
  a 1-second interval is refused by the database.

### Phase 03 — typed parameters + named conditions (migration 012)

- The half of Firebase Remote Config this product never had. Values previously existed only as a
  `feature_flag` config row with a free-form payload: no type, no default, and no way to vary a
  value by audience without authoring a second row and syncing the two by hand.
- Three tables: `parameter` (key, type, default), `condition` (name, predicate, priority),
  `parameter_value` (parameter × condition → value). Parameters and configs stay SEPARATE objects —
  `config` suits bespoke UI overlays, `parameter` suits typed values, and one table doing both
  makes each worse.
- **Conditions are REFERENCED, never copied.** `parameter_value` holds a `condition_id`; editing
  one condition changes every parameter attached to it. Copying the predicate per attachment would
  make "name it once, edit it everywhere" quietly false, with each attachment drifting into its own
  private rule and nothing reporting it. Asserted directly: three parameters share one condition,
  one edit changes all three, and exactly one predicate row exists.
- Ties are structurally impossible: `UNIQUE (parameter_id, priority)`. Two overrides at the same
  priority would make "first match wins" depend on physical row order — not a decision anyone made,
  and not stable across a vacuum.
- The declared type is ENFORCED, not decorative: a boolean parameter cannot hold `"yes"`. That is
  the free-form-payload problem these tables exist to end.
- Resolution lives in SQL (`resolve_parameters`), and `parameters.ts` is a thin caller. The edge
  function already evaluates an audience for configs; a second implementation in TypeScript would
  give the product two definitions of what "Android beta" means — they would agree in review and
  drift in production, and the first symptom would be a user seeing the wrong value.
- Semver compares by padded parts, so 4.10.0 sorts above 4.9.0. A plain text compare gets that
  backwards and silently excludes the newest users from a rollout.
- `RemoteConfigClient` adds `getString` / `getBoolean` / `getLong` / `getDouble` / `getJson`,
  resolving server value → in-app default. The in-app default matters most on a first launch with
  no network: without it every flag-gated feature would be silently off for every new install until
  a fetch landed. A type mismatch falls back rather than throwing — crashing a host app over a
  config value is never the right trade.
- `parameters` added to the wire envelope, defaulted to empty so an older server keeps working.
- Verified live (11/11 in `e2e_sdk_contract.sh`): an android caller receives the condition's value
  and a parameter with no matching condition serves its default, both through the deployed function.

### Phase 02 — the publish gate (migration 011)

- **Every edit used to be live on the next fetch.** `config` rows are now the DRAFT surface;
  `/v1/configs` serves the latest immutable snapshot from the new `config_version` table. Proven
  against the DEPLOYED function: an unpublished edit does not reach devices, and does after Publish.
- `publish(app)` snapshots the enabled drafts; `rollback_to(app, v)` publishes a NEW version
  carrying v's content and never deletes. Verified live: devices receive v1's payload again after
  a rollback, and the undone version stays in history.
- Snapshots EMBED the template contract (`renders_ui`, `requires_ack`, `min_sdk_version`), so
  editing a template cannot silently change what already-published configs do on devices. Schedule
  bounds are evaluated at FETCH time, so a config published today with a start of next Tuesday
  begins serving on Tuesday with no second publish.
- Immutability is a TRIGGER, not a REVOKE: a revoked privilege does not bind the table owner or
  `service_role`, which the edge functions use. UPDATE and DELETE are both refused, proven while
  running as superuser.
- **An app with published versions must stay deletable.** The cascade from `app` fires the
  append-only trigger, which aborted the whole DELETE and made every app with history permanently
  undeletable. The trigger now permits the cascade when the parent app is already gone. Found by
  the live e2e, whose sentinel cleanup silently stopped working.
- `service_role` may publish without a user session — not an escalation, since it already bypasses
  RLS and lives only in the vault; the alternative is every automated caller minting a user JWT.
- An app that has never published serves NOTHING. Fail-closed on purpose: falling back to drafts
  would reinstate this exact gap, silently, on the apps nobody has reviewed yet.
- G-10 holds: 0 anon-callable routines, explicit ACLs, no empty grantee.
- Dashboard: `/apps/[id]/publish` (staged diff, old → new, new/modified/removed) and
  `/apps/[id]/history` (versions, Live badge, forward-only rollback), with a persistent
  unpublished-changes pill in new `[id]/layout.tsx` chrome — on every app route, because a warning
  you only see once you go looking warns nobody. Deployed; interactive spec written but NOT run
  (see below).

### Phase 01 · T6 — 5.0.0 prepared, NOT published

- `gradle.properties#kmpremoteconfig.version` → `5.0.0`; release notes at `docs/releases/5.0.0.md`
  covering the transport change and the removal of `supabaseUrl` / `supabaseKey`.
- **Nothing published.** Two gates are open: repo invariant 6 (KmpToolkit still publishes these
  two coordinates) and epic gate G-11 (no operator has driven the dashboard end to end — the
  deployed plane holds 15 builtin templates and zero apps, keys or configs).
- Canary `tests/fixtures/sdk-control-plane-canary/` locks G-1: the legacy-transport grep fails on
  a red fixture carrying the 3.5.28 PostgREST service and passes on the migrated one. The green
  fixture names the legacy symbols inside a comment on purpose — it proves the predicate reads
  code rather than text, which is the half most easily broken by "fixing" a noisy gate.

### Phase 01 · T5 — live SDK contract check

- Added `supabase/tests/e2e_sdk_contract.sh`: seeds a sentinel app + test key + config on the
  DEPLOYED project, fetches through the real `/v1-configs` edge function with the same headers
  `RemoteConfigService` sends, parses the captured body with the production `RemoteConfigEnvelope`
  under a strict reader, then removes the sentinel (cascade from the app row). Idempotent, zero
  residue. Wired into `control-plane.yml` as the `live-sdk-contract` job on `dev` + manual.
- This is the first check in the project's history that proves the SDK's model against the LIVE
  plane rather than against a committed fixture. A local stack is built from the same migrations
  the fixture reflects, so a migration applied to prod and never committed is invisible to every
  other suite.
- `LiveWireParseTest` (jvmTest) does the parsing. It SKIPS when `-Drc.live.body` is absent, so
  `allTests` stays runnable with no network and no credentials.

### Phase 01 · T1 — shipped wire model (breaking)

- Added `RemoteConfigEnvelope` / `RemoteConfigItem` in `cmp-remote-config`: the SHIPPED model
  for `GET /v1/configs` — `schema_version` + `configs[]`, each carrying `template`, an opaque
  `payload` JsonObject, and `display`.
- The payload stays an opaque object rather than flattened named fields. Flattening is what
  limited the previous model to announcement-shaped configs: `update_available` carries
  store_url / forced / release_notes / current_version and has no title or body, so any fixed
  field set is wrong for most of the fifteen templates.
- Server-side targeting (platform, app-version window, screens, schedule) is deliberately
  absent from the wire item — by the time a config reaches a device it has already matched,
  and shipping the predicates would invite a second, divergent evaluation on the client.
- `RemoteConfigEnvelopeTest` asserts the real `contract/configs-response.json` against these
  production types, including forward-compatibility with an unknown server field.

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
