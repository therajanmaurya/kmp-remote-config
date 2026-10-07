"use client"

import { useState } from "react"
import Link from "next/link"
import { onboardApp, type PlatformBinding } from "@/app/onboarding/actions"
import { validateBundleId, validateCertDigest } from "@/lib/onboarding-validate"

const PLATFORMS = [
  { id: "android", label: "Android", hint: "com.example.app", needsCert: true },
  { id: "ios", label: "iOS", hint: "com.example.App", needsCert: false },
  { id: "desktop", label: "Desktop", hint: "com.example.app", needsCert: false },
  { id: "web", label: "Web", hint: "com.example.app", needsCert: false },
  { id: "wasm", label: "Wasm", hint: "com.example.app", needsCert: false },
] as const

type Draft = Record<string, { on: boolean; bundle_id: string; cert: string }>

/**
 * Kotlin Multiplatform shares ONE application id across every target — that is the ordinary
 * shape for this product, since the SDK exists to serve a KMP app. Per-platform ids are the
 * exception (a separate iOS bundle id, a different web package), so shared is the default and
 * the per-platform form is what you opt into.
 */
type IdMode = "shared" | "per-platform"

const EMPTY: Draft = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, { on: false, bundle_id: "", cert: "" }]),
)

/**
 * First-run registration.
 *
 * Three steps, because the three things an integrator needs are produced at different moments:
 * the app exists, the keys are bound to a package, and the snippet is something they paste.
 * Collapsing them into one form hides the key behind a success toast, which is the one thing
 * they came here to get.
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

  /** Per-field problems, shown inline rather than as one message at the end. */
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
    (idMode === "shared"
      ? sharedId.trim().length > 0
      : chosen.every((p) => draft[p.id].bundle_id.trim().length > 0))

  async function submit() {
    setBusy(true); setError(null)
    // Multiple digests, comma or newline separated: Play App Signing means the upload key and
    // the app-signing key are DIFFERENT certificates, and both must be accepted.
    const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
    const bindings: PlatformBinding[] = chosen.map((p) => ({
      platform: p.id,
      bundle_id: (idMode === "shared" ? sharedId : draft[p.id].bundle_id).trim(),
      // The cert only ever binds the Android key — the other platforms have no equivalent,
      // and attaching it to them would imply a check the server does not perform.
      cert_digests: p.needsCert ? split(idMode === "shared" ? sharedCert : draft[p.id].cert) : [],
    }))
    const res = await onboardApp({ display_name: name, bindings })
    if (!res.ok) { setError(res.error); setBusy(false); return }
    setResult({ appId: res.appId, keys: res.keys })
    setStep(3); setBusy(false)
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <ol className="flex items-center gap-2 text-xs font-medium">
        {["App", "Platforms & signing", "Integrate"].map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3
          return (
            <li key={label} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full font-mono ${
                step >= n ? "bg-primary text-on_primary" : "bg-surface_variant text-secondary"
              }`}>{n}</span>
              <span className={step >= n ? "text-on_surface" : "text-secondary"}>{label}</span>
              {n < 3 && <span className="mx-1 h-px w-6 bg-outline_variant" />}
            </li>
          )
        })}
      </ol>

      {step === 1 && (
        <section className="mt-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {firstRun ? "Register your first app" : "Register an app"}
          </h1>
          <p className="mt-2 text-sm text-secondary">
            An app is one product. Its parameters, configs and keys are scoped to it, and nothing
            is shared with your other apps.
          </p>
          <label className="mt-6 block text-sm font-medium">
            Name
            <input
              data-testid="onboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="rconfig Sample"
              className="mt-1 w-full rounded-md border border-outline px-3 py-2 text-sm"
            />
          </label>
          <button
            data-testid="onboard-next-1"
            disabled={!name.trim()}
            onClick={() => setStep(2)}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on_primary disabled:opacity-50"
          >
            Continue
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="mt-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">Platforms &amp; signing</h1>
          <p className="mt-2 text-sm text-secondary">
            A publishable key ships inside your binary, so it is not a secret. What protects it is
            the binding below: the server checks the package and, on Android, the signing
            certificate on every request.
          </p>

          <div className="mt-6 rounded-lg border border-outline_variant p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary">Application id</p>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="idmode"
                  data-testid="onboard-idmode-shared"
                  className="mt-1"
                  checked={idMode === "shared"}
                  onChange={() => setIdMode("shared")}
                />
                <span>
                  <strong className="font-medium">Kotlin Multiplatform — one id for every target</strong>
                  <span className="mt-0.5 block text-xs text-secondary">
                    A KMP app normally declares a single <code className="font-mono">applicationId</code> and
                    reuses it across Android, iOS, desktop and web. One id, one value to keep in step.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="idmode"
                  data-testid="onboard-idmode-per"
                  className="mt-1"
                  checked={idMode === "per-platform"}
                  onChange={() => setIdMode("per-platform")}
                />
                <span>
                  <strong className="font-medium">A different id per platform</strong>
                  <span className="mt-0.5 block text-xs text-secondary">
                    For a separate iOS bundle id, or a web package that differs from the app.
                  </span>
                </span>
              </label>
            </div>

            {idMode === "shared" && (
              <div className="mt-4 space-y-3 border-t border-outline_variant pt-4">
                <label className="block text-sm">
                  Shared application id
                  <input
                    data-testid="onboard-shared-bundle"
                    value={sharedId}
                    onChange={(e) => setSharedId(e.target.value)}
                    placeholder="com.mobilebytesensei.rconfig"
                    className="mt-1 w-full rounded-md border border-outline px-3 py-2 font-mono text-sm"
                  />
                  {problems["shared-bundle"] && (
                    <span role="alert" className="mt-1 block text-xs text-error">{problems["shared-bundle"]}</span>
                  )}
                </label>
                <label className="block text-sm">
                  SHA-256 certificate fingerprints <span className="text-secondary">(Android only)</span>
                  <textarea
                    data-testid="onboard-shared-cert"
                    value={sharedCert}
                    onChange={(e) => setSharedCert(e.target.value)}
                    rows={2}
                    placeholder="AB:CD:… (one per line)"
                    className="mt-1 w-full rounded-md border border-outline px-3 py-2 font-mono text-xs"
                  />
                  <span className="mt-1 block text-xs text-secondary">
                    Optional, and addable later. Add BOTH your upload key and the Play app-signing
                    key — Play re-signs your bundle, so the fingerprint you see locally is usually
                    not the one that ships. <code className="font-mono">keytool -list -v</code> prints both; use the
                    SHA256 line, not SHA1. Only the Android key is bound to it.
                  </span>
                  {problems["shared-cert"] && (
                    <span role="alert" className="mt-1 block text-xs text-error">{problems["shared-cert"]}</span>
                  )}
                </label>
              </div>
            )}
          </div>

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-secondary">Targets</p>
          <div className="mt-2 space-y-3">
            {PLATFORMS.map((p) => {
              const d = draft[p.id]
              return (
                <div key={p.id} className="rounded-lg border border-outline_variant p-4">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      data-testid={`onboard-platform-${p.id}`}
                      checked={d.on}
                      onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, on: e.target.checked } })}
                    />
                    {p.label}
                    {d.on && idMode === "shared" && sharedId.trim() && (
                      <span className="ml-auto font-mono text-xs text-secondary">{sharedId.trim()}</span>
                    )}
                  </label>

                  {/* Per-platform fields appear ONLY in per-platform mode. In shared mode the
                      id is already shown above, and repeating an editable copy here would
                      invite the two to drift. */}
                  {d.on && idMode === "per-platform" && (
                    <div className="mt-3 space-y-3 pl-6">
                      <label className="block text-sm">
                        Application id
                        <input
                          data-testid={`onboard-bundle-${p.id}`}
                          value={d.bundle_id}
                          onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, bundle_id: e.target.value } })}
                          placeholder={p.hint}
                          className="mt-1 w-full rounded-md border border-outline px-3 py-2 font-mono text-sm"
                        />
                        {problems[`${p.id}-bundle`] && (
                          <span role="alert" className="mt-1 block text-xs text-error">{problems[`${p.id}-bundle`]}</span>
                        )}
                      </label>

                      {p.needsCert && (
                        <label className="block text-sm">
                          SHA-256 certificate fingerprints
                          <textarea
                            data-testid={`onboard-cert-${p.id}`}
                            value={d.cert}
                            onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, cert: e.target.value } })}
                            rows={2}
                            placeholder="AB:CD:… (one per line)"
                            className="mt-1 w-full rounded-md border border-outline px-3 py-2 font-mono text-xs"
                          />
                          {problems[`${p.id}-cert`] && (
                            <span role="alert" className="mt-1 block text-xs text-error">{problems[`${p.id}-cert`]}</span>
                          )}
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {error && <p role="alert" className="mt-4 rounded-md bg-error_container px-3 py-2 text-sm text-on_error_container">{error}</p>}

          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(1)} className="text-sm text-secondary hover:underline">Back</button>
            <button
              data-testid="onboard-create"
              disabled={!step2Ready || busy}
              onClick={submit}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on_primary disabled:opacity-50"
            >
              {busy ? "Registering…" : "Register app"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && result && (
        <section className="mt-8">
          <h1 className="font-display text-2xl font-bold tracking-tight">Integrate</h1>
          <p className="mt-2 text-sm text-secondary">
            Your keys are issued. The <strong>test</strong> key skips attestation so a debug build
            can use it; the <strong>live</strong> key is for your release build.
          </p>

          <div className="mt-5 overflow-hidden rounded-lg border border-outline_variant">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface_variant/50 text-[11px] uppercase text-secondary">
                <tr><th className="px-4 py-2">Platform</th><th className="px-4 py-2">Env</th><th className="px-4 py-2">Key</th></tr>
              </thead>
              <tbody className="divide-y divide-outline_variant">
                {result.keys.map((k) => (
                  <tr key={k.key} data-testid="onboard-key">
                    <td className="px-4 py-2">{k.platform}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                        k.environment === "test" ? "bg-warning_container text-on_warning_container" : "bg-tertiary_container text-on_tertiary_container"
                      }`}>{k.environment}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{k.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-6 text-sm font-semibold">Add the SDK</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-code_background p-4 font-mono text-xs text-code_on_background">
{`// build.gradle.kts
implementation("io.github.mobilebytelabs:cmp-remote-config:5.0.0")
implementation("io.github.mobilebytelabs:cmp-remote-config-compose:5.0.0")`}
          </pre>

          <h2 className="mt-5 text-sm font-semibold">Initialise</h2>
          <pre className="mt-2 overflow-x-auto rounded-md bg-code_background p-4 font-mono text-xs text-code_on_background">
{`remoteConfig {
    publishableKey = "${result.keys.find((k) => k.environment === "test")?.key ?? "rck_test_…"}"
    packageName = "${idMode === "shared" ? sharedId.trim() : (chosen[0] ? draft[chosen[0].id].bundle_id.trim() : "com.example.app")}"
    platform = "${chosen[0]?.id ?? "android"}"
    appVersion = BuildConfig.VERSION_NAME
    httpClient = yourKtorClient
    defaults = remoteConfigDefaults {
        boolean("welcome_banner_enabled", false)
    }
}`}
          </pre>

          <div className="mt-6 flex gap-3">
            {/* A Link, not router.push: this is a NAVIGATION, so it should be reachable by
                middle-click and keyboard, and it survives the client router failing to act on
                a programmatic push — which is exactly what happened here. */}
            <Link
              data-testid="onboard-finish"
              href={`/apps/${result.appId}/parameters`}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on_primary"
            >
              Go to the dashboard
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
