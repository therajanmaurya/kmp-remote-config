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

### Dashboard split in two: organisation matrix, then the app you select

Designed through Stitch as states `org_dashboard` and `admin` (mockups 07–08), then implemented.

- **`/` and `/dashboard` are the ORGANISATION view.** A matrix with one row per app and one
  column per dimension — platforms, parameters, conditions, configs, live version, unpublished,
  keys — so an operator compares apps at a glance instead of opening each in turn. Root no longer
  auto-selects a single app: that shortcut hid exactly the questions this view answers, namely
  which app has unpublished changes and which has never published.
- **The `never published` column is the one to scan first**, and the page says so: an app serving
  nothing to devices looks identical to a healthy one in every other column, however many
  parameters it holds.
- **Admin lives bottom-left**, below a divider, in its own group: Members, Audit log, API access,
  Billing. Placement is the point, not the heading — these are account-wide and some are
  irreversible, so Billing one row under Parameters is how muscle memory ends up somewhere
  expensive. A test asserts the group sits BELOW the workspace nav in the DOM, not merely that
  it is labelled.
- **`OrgShell` is a separate shell from `AppShell`.** Inside an app the nav is Parameters /
  Conditions / Configs; at org level none of those have a subject yet, so offering them would be
  navigation to nothing.
- Members is derived, not invented: membership is per-app (`app_member`), so the page lists the
  apps each person can reach rather than implying an account-wide role that does not exist. Other
  members show by id — `auth.users` is not readable through RLS, and a client-side lookup of it
  would be an email-enumeration surface.
- The staged count in the matrix comes from the SAME `getPublishStatus` the per-app publish page
  uses. A second definition of "unpublished" would eventually disagree, and the org view saying 3
  while the app view says 4 is worse than not showing it.
- Stat cards carry counts only. The mockup also showed total evaluations, edge latency and an
  attestation posture score; none has a data source.

Verified in a browser: `/` lands on the matrix, two seeded apps compare correctly
(`never published` against `v1`), the admin group renders below the workspace nav with all four
entries, selecting a row opens that app's control plane, and its Keys page is app-scoped.

**The icon guard earned its keep again** — it caught six new nav icons (`api`, `apps`,
`credit_card`, `grid_view`, `group`, `receipt_long`) that would have shipped as literal ligature
text.

### Sample restructured to the Kotlin Multiplatform wizard layout

Taken from the canonical `Kotlin/kmp-app-template` rather than invented: a shared module holding
`App()`, and one thin entry-point module per platform.

| Module | Entry point |
|---|---|
| `:sample` | `App()`, the integration, and `MainViewController()` for iOS |
| `:sampleAndroidApp` | `MainActivity` → **builds a real 22MB APK** |
| `:sampleDesktopApp` | `main()` → `./gradlew :sampleDesktopApp:run` |
| `:sampleWebApp` | `main()` → `ComposeViewport` on wasmJs |
| `:sample-headless` | no Compose at all, on linux/mingw/watchOS/tvOS |

Each shell supplies its own HttpClient engine (OkHttp / CIO / Darwin / Js) — the SDK ships none
across fifteen targets — and its own stable device id (ANDROID_ID, Preferences, identifierForVendor,
localStorage). Stability is the requirement, not identity: an id regenerated per launch would
re-roll rollout membership every time, which surfaces as a flickering feature nobody traces back
to a rollout.

**Three build-level defects the restructure exposed, none reachable before:**

- **`CmpMetadata` was generated by BOTH modules into the same package**, so any Android app
  depending on both artefacts — the normal case — failed to dex with
  `Type com.mobilebytelabs.remoteconfig.CmpMetadata is defined multiple times`. The compose module
  had **zero references** to it, so not generating it there is both the smallest fix and the right
  one. Nothing caught this because no Android consumer used both until `:sampleAndroidApp` existed.
- **`org.jetbrains.kotlin.android` now hard-errors** under AGP 9, which applies Kotlin itself. The
  wizard's template still lists it because it targets an older AGP.
- `kotlinOptions { }` went with that plugin and was both unresolvable and redundant.

The iOS Kotlin half is verified (`compileKotlinIosSimulatorArm64` passes); the Xcode project is
documented in `sampleIosApp/README.md` rather than committed, because a hand-written `.xcodeproj`
is a generated file with absolute paths and a project UUID that opens and then fails in ways
nobody can debug.

### Fixed — a staged rollout reached NOBODY through the documented integration

- The `remoteConfig { }` Koin DSL registered a `DeviceIdProvider` singleton and then built the
  service **without it**. Every app integrating the documented way therefore sent no
  `X-RC-Device`, and the server deliberately excludes an unidentified caller from any PARTIAL
  rollout — so Phase 05's staged rollout reached nobody, silently, for every consumer. Nothing
  failed; the feature simply did not work.
- Found by making the sample runnable: the SDK's own tests construct a `RemoteConfigService`
  directly and never exercised the wiring Koin produces. `RemoteConfigDslTest` now drives the
  DSL itself and asserts the full header tuple plus a stable device id across fetches — a
  per-request id would re-roll bucket membership on every poll, which is the "feature keeps
  flickering" bug that reads as a product defect rather than a config one.
- Fixing it surfaced a second latent fault: `singleOf(::DeviceIdProvider)` asks Koin to resolve
  EVERY constructor parameter including defaulted ones, so its `Settings = defaultSettings()`
  became a missing definition the moment anything actually resolved the type. Both providers are
  now registered with explicit constructors so their defaults are honoured.
- The DSL's own KDoc still advertised `supabaseUrl` / `supabaseKey`, removed in 5.0.0. It is the
  first thing an integrator reads, and it told them to use properties that no longer exist.

### Sample — now actually runnable

- `./gradlew :sample:run` opens a desktop window. Koin wiring in `sampleModule()` exactly as the
  dashboard snippet describes, action handlers for store / url / acknowledge / submit, and the
  REAL `RemoteConfigHost()` mounted rather than a placeholder describing one.
- The publishable key comes from `RCONFIG_PUBLISHABLE_KEY`, not a constant: a key is not a
  secret, but a sample with somebody's real key baked in stops working the day that app is
  deleted and invites copy-paste into a reader's project. Without it the app exits with the
  instruction rather than a stack trace.
- Verified by running it against the live control plane with a real issued key: launched, Koin
  started, window up, **zero exceptions**.

### Samples — the Compose half and the headless half, both compiled

Two sample modules, because the library is two artefacts and a single sample could only ever
prove one of them.

- **`:sample`** — Compose Multiplatform on jvm, android, iosArm64, iosSimulatorArm64 and wasmJs,
  mirroring `cmp-remote-config-compose`'s reach. One screen shows BOTH halves side by side:
  typed value reads through `RemoteConfigClient` (pure Kotlin, no Compose involved) and a
  delivered UI config. Keeping them visibly separate is the point — a host app usually wants the
  first and only sometimes the second.
- **`:sample-headless`** — the SAME SDK with no Compose anywhere. Applies neither Compose plugin,
  depends only on `:cmp-remote-config`, and targets **linuxX64, mingwX64, watchosArm64 and
  tvosArm64 — none of which Compose Multiplatform publishes for.** A server, a CLI, a watch
  complication. 7 contract tests covering the polling loop a backend actually runs: bundled
  defaults before any fetch, the kill switch honoured from CACHE, the interval, the client floor,
  and a refusal RETURNED rather than swallowed.
- **The headless guarantee is mechanical.** Adding `:cmp-remote-config-compose` to that module
  fails the linuxX64 build outright — proven by injecting it, watching
  `Could not resolve project ':cmp-remote-config-compose'`, and restoring. If the core ever
  acquires a Compose dependency, this module stops compiling. No test of the library's own source
  could give that.
- Both samples depend on the PROJECTS rather than published coordinates, so they break when the
  SDK changes under them — the only reason to keep a sample in-repo.

**A real packaging bug the first sample found immediately:** `kotlinx-serialization-json` was
`implementation`, not `api`. `remoteConfigDefaults` returns a `JsonObject` and
`RemoteConfigItem.payload` IS one, so those types were absent from every consumer's compile
classpath and **the integration snippet the dashboard prints would not have compiled for anyone.**
Promoted to `api` in both modules. A dependency that appears in your API is part of your API.

`apiCheck` then failed correctly on 327 lines of new 5.0.0 public surface (`RemoteConfigClient`,
the defaults builder, `SdkSettings`, the envelope types) — all intentional for a breaking major,
so the dump was regenerated.

### MCP server — onboarding and config management as tools

- 12 tools over stdio: discovery (`list_apps`, `list_parameters`, `list_conditions`,
  `list_versions`), `onboard_app`, authoring (`create_parameter`, `create_condition`,
  `add_override`), inspection (`preview_for_device`, `explain_parameter`), and release
  (`publish`, `rollback`).
- **Auth, decided rather than invented**: operator-local, service-role key from the environment —
  the same trust model `supabase-connect.sh` and `e2e_sdk_contract.sh` already use here. The
  consequence is stated in the code rather than left to be discovered: service_role bypasses RLS,
  so the `app_id` scoping IS the tenant boundary with no policy behind it. Not multi-tenant, never
  over a network transport.
- **`publish` is its own tool, deliberately.** A combined set-and-publish would make the Phase 02
  safety gate decorative; an agent can stage ten edits and a human can still look first. A test
  asserts no other tool's name contains "publish".
- 13 tests: 9 over the operations layer, each asserting a raw Postgres constraint name does NOT
  survive into a message a model reads, and **4 driving the built server over real stdio** —
  handshake, tool listing, description quality, and the publish separation. That last set already
  caught `list_apps` shipping a description too thin for a model to choose from.

### Onboarding redesigned through Stitch (mockups 07–09)

- The first onboarding build was hand-rolled — a bare form in whitespace — while every other
  screen in this product is designed in the idea layer and generated. Corrected: three new states
  (`onboarding_app`, `onboarding_platforms`, `onboarding_integrate`) authored into
  `dashboard-remote-config/ui.yaml`, generated through the Stitch pipeline, and implemented.
- These are the only states with NO sidebar and NO publish chrome: there is no app yet, so a
  sidebar would offer navigation to nothing and the unpublished-changes pill would describe a
  surface the operator has not reached.
- Implemented from the mockups: the step rail with a "STEP n OF 3 · SETUP" eyebrow and a tick on
  completed steps, a live slug preview, the "what you will need" aside, the Unified-KMP-id choice
  card carrying a RECOMMENDED badge, the "Android only · optional" fingerprint chip, the amber
  keytool caution, platform chips, and copy affordances on the id, each key and both code panels.
- **Stitch returned 07 dark and 08/09 light.** Implemented in the LIGHT language, which is the
  product's design system — three onboarding screens in a palette no other screen uses would be a
  worse outcome than deviating from one generated image.
- Stat cards on the final step carry real counts only. The mockup also showed edge latency and an
  attestation badge; neither has a data source, and a fabricated figure beside a real one teaches
  an operator to distrust both.

**A blind spot found in my own guard test:** three icons added inside ternaries
(`{done ? "check" : "content_copy"}`) were invisible to the icon-subset extractor and would have
shipped as literal ligature text — the exact failure that test exists to prevent. The extractor
now reads every quoted token inside a material-symbols span, and the fix is proven: removing
`content_copy` from the subset fails the test.

### Onboarding — real app registration, KMP-first

- **Demo seed removed from prod.** The dashboard no longer ships pre-seeded data; a new account
  registers its own app.
- **`/onboarding`**: three steps, because the three things an integrator needs arrive at different
  moments — the app exists, the keys are bound to a package, and the snippet is something they
  paste. An account with no apps lands here rather than on an empty list whose only control is a
  button.
- **Kotlin Multiplatform is the DEFAULT id mode**: one `applicationId` shared across every target,
  which is the ordinary shape for a KMP app. Per-platform ids are the opt-in. Verified end to end:
  3 targets, 6 keys, one shared `com.mobilebytesensei.rconfig`, and cert digests bound ONLY to the
  Android keys — the other platforms have no equivalent, and attaching it would imply a check the
  server does not perform.
- **SHA-256, plural, and SHA-1 refused by name.** `keytool` prints SHA1 first, so it is the value
  most likely pasted; Play App Signing reports SHA-256, so a SHA-1 here can never match and the
  only symptom is a bare `cert_mismatch` on device. Plural because Play re-signs — the upload key
  and the app-signing key are different certificates and both must be accepted. 20 unit tests.
- Validation runs BEFORE any write: a half-registered app is worse than none, and failing midway
  would leave an app row with no keys and a form now reporting a duplicate slug.

**Three bugs found by walking it in a browser:**
- `revalidatePath("/", "layout")` in the action remounted the tree it was called from, so the
  client's `await` resolved to `undefined` and the wizard died on `res.ok` having just succeeded.
- The finish control used `router.push` and silently did nothing. It is a NAVIGATION, so it is now
  a `Link` — reachable by middle-click and keyboard, and immune to the client router not acting.
- The insert's `RETURNING` intermittently came back empty through RLS, leaving a success screen
  with no keys on it. The action already holds every key from `generate_publishable_key`, so there
  was nothing to re-read.

### Roborazzi goldens — and the two rendering bugs they immediately found

- 10 golden images for the nine designed template bodies (`src/jvmTest/roborazzi/`). JVM-only:
  the bodies live in `commonMain` and every target composes the same tree, so one capture covers
  all of them — running per-platform would compare the same composition against itself.
- **The goldens found real bugs on their first run, which is the point.** `survey_nps` with
  `scale_max: 10` renders ELEVEN chips (0..10); at a fixed 28.dp they overflowed the row and the
  **10 was clipped away** — an NPS survey that could not record its top score. And the decline
  button clipped its own label mid-word ("Maybe late…"). Both compiled, both passed every other
  test in the module, and neither was visible without rendering.
- Fixed by weighting the chips instead of sizing them, and by keeping button labels on one line —
  a button states an action, so shrinking a label beats hiding half of it.
- **The suite is proven to fail**: verified green unchanged, verified RED against an injected
  regression in `PaywallBody`, verified green again on restore. A golden suite that cannot fail
  is worse than none, because it reports confidence it has not earned.
- Goldens are reviewed before committing. One accepted unseen records whatever the bug produced
  and then defends it.

### Fixed — the 4MB font: the site was slow because of one missing URL parameter

- The dashboard downloaded a **4,003,092-byte font** on every first visit. Google serves the
  COMPLETE Material Symbols variable font unless the stylesheet URL carries `icon_names`. Subset
  to the fourteen icons this app renders, the same font is **19,176 bytes — 99.5% smaller**.
- Nothing failed and nothing warned; the only symptom was that the site felt slow. Measured
  before/after in a real browser: the 4MB CSS/font bucket is gone and a warm load is ~366ms.
- `__tests__/icon-font.test.ts` locks it three ways: the URL must stay subsetted, every icon the
  source renders must be IN the subset (or it renders as its ligature text and the tempting
  "fix" is deleting the parameter), and no declared icon may be unused.

### Fixed — sign-in was dead on every deploy I made

- **Clicking "Continue with Google" stuck on "Redirecting to Google…" forever.** Two independent
  faults, both mine:
  1. `npm run pages:deploy` built LOCALLY without `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY`. Those
     are inlined by Next at BUILD time, so every bundle I shipped had no Supabase config and
     `createClient()` threw on page load. Nothing failed: `next build` exited 0, the upload
     succeeded, every route returned 200.
  2. The click handler had no try/catch. It only reset `busy` for a RETURNED error, so a THROWN
     one left the single control on the page permanently disabled with nothing on screen.
- Sign-in logic extracted to `lib/sign-in.ts` as a pure function taking the client factory, so the
  control flow is testable in node — the failure was about control flow, not rendering, and a test
  needing jsdom would not have been written. 5 unit tests: thrown error, non-Error throw, returned
  OAuth error, rejected promise, and the success path asserting the callback targets THIS origin.
- `__tests__/bundle-env.test.ts` asserts the ARTIFACT, not the environment — "did the values reach
  the bundle", not "were they set in some shell". It also asserts the service-role key is NOT
  inlined, the counterpart risk to fixing this carelessly.
- `scripts/deploy.sh` is now the only deploy path (`pages:deploy` routes through it): resolves the
  public config from the vault, builds, RUNS THE BUNDLE GATE, and refuses to upload if it fails.
  Env resolution cannot be a step someone remembers.
- Two bugs found while writing that script, both the same footgun as the `supabase-connect.sh`
  one: `exit` inside a function called via `$(...)` runs in a SUBSHELL and cannot stop the script,
  so a failed resolve silently produced an empty variable; and `secrets-get.sh` is CWD-dependent —
  the identical call succeeds from the framework root and fails from the dashboard directory, the
  same thing `/idea-feature-stitch` shipped `stitch-key-resolve.sh` to work around.
- Verified in a browser: the click now navigates to `accounts.google.com`. e2e guard added to the
  production smoke suite (6/6 green) asserting sign-in either navigates, re-enables, or shows an
  error — never sticks.

### SDK — the nine config-template designs

- The `config-templates` mockups (9 screens) are now per-template Compose bodies. Before this the
  SDK had FOUR generic presentations fed by `ConfigContent`, which derived a title and body by
  guessing at payload keys — so `update_available` (store_url / forced / release_notes /
  current_version, **no title at all**) rendered as an empty dialog with a generic heading, and
  `survey_nps` reduced to a heading and a button that could not collect a score.
- Each body reads only the fields ITS OWN schema declares, taken from the live control plane
  rather than guessed: announcement, update_available (both the optional dialog and the forced
  fullscreen — one body, `forced` changes copy and removes the decline), policy_update,
  paywall_upsell, incident/information/maintenance/geo_notice/onboarding_tip (one severity-toned
  strip, since those five schemas differ only in an optional field), survey_nps with a real
  0..10 scale, whats_new, promo_offer, rating_prompt.
- **Surface and content are separate.** `display` picks the chrome (`TemplateSurface`) and the
  template picks the body, which is why update_available is one body shown two ways. Binding
  content to surface would have meant writing it twice and letting the copies drift.
- **A banner is inline chrome, not a Dialog.** Wrapping it in one is what would make a "banner"
  a modal over the host's layout.
- **Un-escapable when it must be**: a surface is dismissible only when the item says so AND the
  template does not declare `requires_ack`. A forced update renders no decline at all, because a
  control the evaluator would ignore is a control that lies.
- `ActionType` gains `ACKNOWLEDGE` and `SUBMIT`. Acknowledge is distinct from dismiss on purpose:
  both close the surface, but only one records that the user ACCEPTED — collapsing them makes a
  compliance surface indistinguishable from a tap on the backdrop. Submit carries the NPS score,
  which is why a submit with nothing selected must not fire.
- **The generic presentation stays** as the path for custom templates and for builtins added to
  the control plane after this SDK ships. It is the forward-compatibility story, not dead code —
  a registry that threw on an unknown id would make every new template a mandatory SDK upgrade.
  Asserted in both directions: all 14 rendering builtins have a body, `feature_flag`
  (`renders_ui = false`) has none, and an unknown id falls through.
- `TemplatePayload` tolerates missing, blank and wrongly-typed fields. The payload is authored in
  a dashboard and validated by a schema the DEVICE never sees, so a reader that threw would turn
  an operator's typo into a crash in the host app.

### Phase 06 — the mockup design, demo data, and the parameter editor

- **The design from the mockups is now actually implemented.** The earlier pages had the right
  BEHAVIOUR and none of the design: no sidebar, no chrome, none of the colour system. Added the
  tokens verbatim from the stitch `code.html` (the full role palette, Inter + JetBrains Mono,
  Material Symbols, radius scale), the 64-unit sidebar shell with breadcrumbs and environment
  chip, and hero / stat-card / panel treatments. 24 files migrated; zero `neutral-` references
  remain, so no surface is left half-styled.
- **Demo data seeded** (`supabase/seed_demo.sql`, operator-approved): Lumen Photos with the
  mockups' own parameters, the four named conditions, seven overrides, a config, a test key and
  two published revisions. The deployed plane had 15 builtin templates and zero apps, so signing
  in landed on an empty list — and an empty dashboard is indistinguishable from a broken one.
  Idempotent, owned by the real operator account, publishes AS the owner rather than loosening
  `publish()` to accommodate a seed.
- **Signing in with one app goes straight to its control plane** instead of a chooser with one
  choice. Reported from a live session landing on `/auth/login` with nothing behind it.
- **Parameter editor rebuilt to mockup 02**: an evaluation-precedence list where the default is
  the final row of the same ordered list — it is the last branch of one decision, and showing it
  elsewhere invites the reading that it applies alongside the overrides rather than after them.
- **Live evaluator** (migration 015, `resolve_parameter_explain`): pick a sample audience, see
  which rule won and why. It reuses the same `condition_matches` the edge function resolves
  with, so the explanation can never describe a decision different from the one a device gets.
  Verified against the seeded data — android 4.3.0 → true via "Android beta users", ios 4.5.0 →
  true via "iOS 4.2 and newer", android 3.1.0 → default (below the condition's min version).
  Authorisation is explicit because SECURITY DEFINER bypasses RLS, and the explanation leaks
  condition names, not just a value.
- Mockup 06 (templates) is a stub — README only, no `code.html` or `screen.png`, its metadata
  lost to a stitch-verify regeneration. There is no templates design to implement; the existing
  page carries the shared design language instead.

### Phase 06 (earlier) — parameters + conditions UI (T1), device preview (T2)

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
