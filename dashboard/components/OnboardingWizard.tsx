"use client"

import { useState } from "react"
import Link from "next/link"
import { onboardApp, type PlatformBinding } from "@/app/onboarding/actions"
import { validateBundleId, validateCertDigest } from "@/lib/onboarding-validate"
import { slugify } from "@/lib/slug"
import { Rail } from "@/components/onboarding/Rail"
import { Caution, ChoiceCard, CodePanel, CopyButton, Panel } from "@/components/onboarding/Parts"

const PLATFORMS = [
  { id: "android", label: "Android", needsCert: true },
  { id: "ios", label: "iOS", needsCert: false },
  { id: "desktop", label: "Desktop (JVM)", needsCert: false },
  { id: "web", label: "Web", needsCert: false },
  { id: "wasm", label: "Wasm", needsCert: false },
] as const

type Draft = Record<string, { on: boolean; bundle_id: string; cert: string }>
const EMPTY: Draft = Object.fromEntries(PLATFORMS.map((p) => [p.id, { on: false, bundle_id: "", cert: "" }]))

/** KMP shares ONE application id across targets; per-platform is the exception, so shared leads. */
type IdMode = "shared" | "per-platform"

/**
 * First-run registration, built from mockups 07–09.
 *
 * These are the only screens in the product with no sidebar and no publish chrome: there is no
 * app yet, so a sidebar would offer navigation to nothing and the unpublished-changes pill
 * would describe a surface the operator has not reached.
 */
export function OnboardingWizard({ firstRun }: { firstRun: boolean }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState("")
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [idMode, setIdMode] = useState<IdMode>("shared")
  const [sharedId, setSharedId] = useState("")
  const [sharedCert, setSharedCert] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ appId: string; keys: { environment: string; platform: string; key: string }[] } | null>(null)

  const chosen = PLATFORMS.filter((p) => draft[p.id].on)
  const slug = slugify(name)

  const problems: Record<string, string> = {}
  if (idMode === "shared") {
    if (sharedId.trim()) {
      const v = validateBundleId(sharedId)
      if (!v.ok) problems["shared-bundle"] = v.error
    }
    for (const line of sharedCert.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
      const v = validateCertDigest(line)
      if (!v.ok) { problems["shared-cert"] = v.error; break }
    }
  } else {
    for (const p of chosen) {
      const d = draft[p.id]
      if (d.bundle_id.trim()) {
        const v = validateBundleId(d.bundle_id)
        if (!v.ok) problems[`${p.id}-bundle`] = v.error
      }
      if (p.needsCert && d.cert.trim()) {
        const v = validateCertDigest(d.cert)
        if (!v.ok) problems[`${p.id}-cert`] = v.error
      }
    }
  }

  const step2Ready =
    chosen.length > 0 &&
    Object.keys(problems).length === 0 &&
    (idMode === "shared" ? sharedId.trim().length > 0 : chosen.every((p) => draft[p.id].bundle_id.trim().length > 0))

  const effectiveId = idMode === "shared"
    ? sharedId.trim()
    : (chosen[0] ? draft[chosen[0].id].bundle_id.trim() : "com.example.app")

  async function submit() {
    setBusy(true); setError(null)
    const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
    const bindings: PlatformBinding[] = chosen.map((p) => ({
      platform: p.id,
      bundle_id: (idMode === "shared" ? sharedId : draft[p.id].bundle_id).trim(),
      // The cert binds the Android key only — the other platforms have no equivalent, and
      // attaching it would imply a check the server does not perform.
      cert_digests: p.needsCert ? split(idMode === "shared" ? sharedCert : draft[p.id].cert) : [],
    }))
    const res = await onboardApp({ display_name: name, bindings })
    if (!res.ok) { setError(res.error); setBusy(false); return }
    setResult({ appId: res.appId, keys: res.keys })
    setStep(3); setBusy(false)
  }

  return (
    <div className="min-h-screen bg-surface_variant">
      <header className="border-b border-outline_variant bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-2.5 px-6 py-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-on_primary">rc</span>
          <span className="font-headline text-base font-bold tracking-tight">rconfig</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <Rail step={step} />

        {step === 1 && (
          <div className="mx-auto mt-8 max-w-xl space-y-4">
            <Panel
              title={firstRun ? "Register your first app" : "Register an app"}
              subtitle="An app is one product. Its parameters, configs and keys are scoped to it."
            >
              <label className="block text-sm font-medium">
                Name
                <input
                  data-testid="onboard-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="rconfig Sample"
                  className="mt-1.5 w-full rounded-lg border border-outline px-3 py-2.5 text-sm"
                />
              </label>

              {/* The slug is shown live because it ends up in key prefixes and logs, and is
                  fixed at creation — seeing it before committing is cheaper than renaming. */}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-secondary">Slug preview</span>
                <code className="rounded bg-surface_variant px-1.5 py-0.5 font-mono text-on_surface_variant">
                  {slug || "—"}
                </code>
                {slug && (
                  <span className="ml-auto inline-flex items-center gap-1 text-tertiary">
                    <span className="material-symbols-outlined text-[14px]" aria-hidden>check_circle</span>
                    looks good
                  </span>
                )}
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  data-testid="onboard-next-1"
                  disabled={!name.trim()}
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on_primary disabled:opacity-50"
                >
                  Continue
                  <span className="material-symbols-outlined text-[16px]" aria-hidden>chevron_right</span>
                </button>
              </div>
            </Panel>

            <div className="flex gap-3 rounded-xl border border-outline_variant bg-surface px-5 py-4">
              <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden>info</span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary">What you will need</p>
                <p className="mt-1 text-xs leading-relaxed text-on_surface_variant">
                  Your application id, for example <code className="font-mono">com.mobilebytesensei.rconfig</code>,
                  and on Android the SHA-256 fingerprint of your signing certificate. Both can be
                  added or changed later — this aside exists so nobody abandons the flow hunting
                  for a fingerprint.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-8 space-y-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">Platforms and signing</h1>
              <p className="mt-1 text-sm text-secondary">
                Configure how your Kotlin Multiplatform targets identify themselves. A publishable
                key ships inside your binary, so what protects it is the binding below — not secrecy.
              </p>
            </div>

            <Panel
              title="Application id architecture"
              subtitle="KMP is the default because this SDK exists to serve a Kotlin Multiplatform app."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  testId="onboard-idmode-shared"
                  selected={idMode === "shared"}
                  onSelect={() => setIdMode("shared")}
                  title="Unified KMP id"
                  body="One id for every target. A KMP app declares a single applicationId and reuses it across Android, iOS, desktop and web."
                  recommended
                />
                <ChoiceCard
                  testId="onboard-idmode-per"
                  selected={idMode === "per-platform"}
                  onSelect={() => setIdMode("per-platform")}
                  title="Per-platform ids"
                  body="For a separate iOS bundle id, or a web package that differs from the app."
                />
              </div>
            </Panel>

            {idMode === "shared" && (
              <Panel title="Shared application id" subtitle="This identity scopes every publishable key issued below.">
                <label className="block text-sm font-medium">
                  Application id
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      data-testid="onboard-shared-bundle"
                      value={sharedId}
                      onChange={(e) => setSharedId(e.target.value)}
                      placeholder="com.mobilebytesensei.rconfig"
                      className="w-full rounded-lg border border-outline px-3 py-2.5 font-mono text-sm"
                    />
                    {sharedId.trim() && <CopyButton value={sharedId.trim()} />}
                  </div>
                  {problems["shared-bundle"] && (
                    <span role="alert" className="mt-1 block text-xs text-error">{problems["shared-bundle"]}</span>
                  )}
                </label>

                <label className="mt-4 block text-sm font-medium">
                  <span className="flex flex-wrap items-center gap-2">
                    SHA-256 fingerprints
                    <span className="rounded bg-tertiary_container px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-on_tertiary_container">
                      Android only · optional
                    </span>
                  </span>
                  <textarea
                    data-testid="onboard-shared-cert"
                    value={sharedCert}
                    onChange={(e) => setSharedCert(e.target.value)}
                    rows={2}
                    placeholder="AB:CD:EF:… (one per line)"
                    className="mt-1.5 w-full rounded-lg border border-outline px-3 py-2.5 font-mono text-xs"
                  />
                  {problems["shared-cert"] && (
                    <span role="alert" className="mt-1 block text-xs text-error">{problems["shared-cert"]}</span>
                  )}
                </label>

                <div className="mt-3">
                  <Caution>
                    <strong className="font-semibold">keytool prints SHA1 first.</strong> Play App
                    Signing reports SHA-256, so a SHA-1 fingerprint can never match and the only
                    symptom is a bare <code className="font-mono">cert_mismatch</code> on device. Add
                    both your upload key and the Play app-signing key — Play re-signs your bundle,
                    so the fingerprint you see locally is usually not the one that ships.
                  </Caution>
                </div>
              </Panel>
            )}

            <Panel
              title="Active target platforms"
              subtitle="Each selected target is issued its own live and test key."
              aside={
                <span className="rounded-full bg-surface_variant px-2 py-1 font-mono text-[10px] font-semibold text-secondary">
                  {chosen.length} selected
                </span>
              }
            >
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const d = draft[p.id]
                  return (
                    <label
                      key={p.id}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        d.on ? "border-primary bg-primary_container/40 font-medium" : "border-outline_variant hover:border-outline"
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-testid={`onboard-platform-${p.id}`}
                        checked={d.on}
                        onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, on: e.target.checked } })}
                        className="sr-only"
                      />
                      <span className={`material-symbols-outlined text-[16px] ${d.on ? "text-primary" : "text-outline"}`} aria-hidden>
                        {d.on ? "check_circle" : "radio_button_unchecked"}
                      </span>
                      {p.label}
                    </label>
                  )
                })}
              </div>

              {/* In shared mode the SAME id is echoed against every chosen target. That
                  repetition IS the screen's point: one value, visibly applying everywhere. */}
              {idMode === "shared" && chosen.length > 0 && sharedId.trim() && (
                <ul className="mt-4 divide-y divide-outline_variant rounded-lg border border-outline_variant">
                  {chosen.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className="font-medium">{p.label}</span>
                      <code className="font-mono text-secondary">{sharedId.trim()}</code>
                    </li>
                  ))}
                </ul>
              )}

              {idMode === "per-platform" && chosen.length > 0 && (
                <div className="mt-4 space-y-3">
                  {chosen.map((p) => {
                    const d = draft[p.id]
                    return (
                      <div key={p.id} className="rounded-lg border border-outline_variant p-3">
                        <p className="text-xs font-semibold">{p.label}</p>
                        <input
                          data-testid={`onboard-bundle-${p.id}`}
                          value={d.bundle_id}
                          onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, bundle_id: e.target.value } })}
                          placeholder="com.example.app"
                          className="mt-1.5 w-full rounded-lg border border-outline px-3 py-2 font-mono text-sm"
                        />
                        {problems[`${p.id}-bundle`] && (
                          <span role="alert" className="mt-1 block text-xs text-error">{problems[`${p.id}-bundle`]}</span>
                        )}
                        {p.needsCert && (
                          <>
                            <textarea
                              data-testid={`onboard-cert-${p.id}`}
                              value={d.cert}
                              onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, cert: e.target.value } })}
                              rows={2}
                              placeholder="SHA-256 fingerprints, one per line (optional)"
                              className="mt-2 w-full rounded-lg border border-outline px-3 py-2 font-mono text-xs"
                            />
                            {problems[`${p.id}-cert`] && (
                              <span role="alert" className="mt-1 block text-xs text-error">{problems[`${p.id}-cert`]}</span>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            {error && (
              <p role="alert" className="rounded-lg border border-error/30 bg-error_container px-4 py-3 text-sm text-on_error_container">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setStep(1)} className="inline-flex items-center gap-1 text-sm text-secondary hover:text-on_surface">
                <span className="material-symbols-outlined rotate-180 text-[16px]" aria-hidden>chevron_right</span>
                Back
              </button>
              <button
                data-testid="onboard-create"
                disabled={!step2Ready || busy}
                onClick={submit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on_primary disabled:opacity-50"
              >
                {busy ? "Registering…" : "Continue to integration"}
                <span className="material-symbols-outlined text-[16px]" aria-hidden>chevron_right</span>
              </button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="mt-8 space-y-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">Add the SDK and initialise</h1>
              <p className="mt-1 text-sm text-secondary">
                Connect your client applications using the issued keys and the initialisation block below.
              </p>
            </div>

            {/* Real counts only. The mockup also showed edge latency and an attestation badge;
                neither has a data source, and a fabricated figure beside a real one teaches an
                operator to distrust both. */}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Targets", value: String(chosen.length) },
                { label: "Keys issued", value: String(result.keys.length) },
                { label: "Attestation", value: "test off · live preferred" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-outline_variant bg-surface px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-secondary">{s.label}</p>
                  <p className="mt-1 font-display text-lg font-bold tracking-tight">{s.value}</p>
                </div>
              ))}
            </div>

            <Panel title="Your keys" subtitle="Scoped to this app and bound to the id above.">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-wide text-secondary">
                    <tr>
                      <th className="pb-2 font-semibold">Platform</th>
                      <th className="pb-2 font-semibold">Environment</th>
                      <th className="pb-2 font-semibold">Publishable key</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline_variant">
                    {result.keys.map((k) => (
                      <tr key={k.key} data-testid="onboard-key">
                        <td className="py-2.5">{k.platform}</td>
                        <td className="py-2.5">
                          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                            k.environment === "test"
                              ? "bg-warning_container text-on_warning_container"
                              : "bg-tertiary_container text-on_tertiary_container"
                          }`}>{k.environment}</span>
                        </td>
                        <td className="py-2.5 font-mono text-xs">{k.key}</td>
                        <td className="py-2.5 text-right"><CopyButton value={k.key} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4">
                <Caution>
                  The <strong className="font-semibold">test</strong> key skips attestation so a
                  debug build can use it — Play Integrity rejects debug and sideloaded builds, so a
                  developer could otherwise never run their own app. Use the{" "}
                  <strong className="font-semibold">live</strong> key for your release build.
                </Caution>
              </div>
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2">
              <CodePanel
                caption="build.gradle.kts"
                code={`sourceSets {\n    commonMain.dependencies {\n        implementation("io.github.mobilebytelabs:cmp-remote-config:5.0.0")\n        implementation("io.github.mobilebytelabs:cmp-remote-config-compose:5.0.0")\n    }\n}`}
              />
              <CodePanel
                caption="App.kt · remoteConfig"
                code={`remoteConfig {\n    publishableKey = "${result.keys.find((k) => k.environment === "test")?.key ?? "rck_test_…"}"\n    packageName = "${effectiveId}"\n    platform = "${chosen[0]?.id ?? "android"}"\n    appVersion = BuildConfig.VERSION_NAME\n    httpClient = yourKtorClient\n\n    defaults = remoteConfigDefaults {\n        boolean("welcome_banner_enabled", false)\n    }\n}`}
              />
            </div>

            <div className="flex justify-end">
              {/* A Link, not a programmatic push: this is a navigation, so it stays
                  middle-clickable and keyboard-reachable. */}
              <Link
                data-testid="onboard-finish"
                href={`/apps/${result.appId}/parameters`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on_primary"
              >
                Complete setup and go to the dashboard
                <span className="material-symbols-outlined text-[16px]" aria-hidden>chevron_right</span>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
