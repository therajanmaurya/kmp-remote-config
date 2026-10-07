"use client"

import { useState, useTransition } from "react"
import { explainParameter, type Explanation } from "@/app/apps/[id]/parameters/actions"

const PLATFORMS = ["android", "ios", "web", "desktop", "wasm"]

/**
 * Mockup 02's live evaluator: pick a sample audience, see which rule actually won.
 *
 * This is the control that stops an operator guessing. "Why is my phone getting the default?"
 * is the question the precedence list above cannot answer on its own — it shows the ORDER, not
 * the OUTCOME for a specific device.
 *
 * The answer comes from `resolve_parameter_explain`, which reuses the same `condition_matches`
 * the edge function resolves with. A second matcher written for this panel would eventually
 * disagree with production, and an evaluator that lies is worse than no evaluator.
 */
export function LiveEvaluator({ parameterId }: { parameterId: string }) {
  const [platform, setPlatform] = useState("android")
  const [appVersion, setAppVersion] = useState("4.3.0")
  const [screen, setScreen] = useState("")
  const [result, setResult] = useState<Explanation | null>(null)
  const [pending, start] = useTransition()

  function run() {
    start(async () => {
      setResult(await explainParameter(parameterId, {
        platform,
        app_version: appVersion,
        screen: screen.trim() || null,
      }))
    })
  }

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-primary/30 bg-primary_container/30">
      <header className="flex items-center justify-between gap-3 border-b border-primary/20 px-5 py-3">
        <h2 className="flex items-center gap-2 font-headline text-sm font-semibold">
          <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden>bolt</span>
          Resolved for a sample device
        </h2>
        <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-on_primary">
          LIVE EVALUATOR
        </span>
      </header>

      <div className="px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">Platform</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}
              data-testid="eval-platform"
              className="mt-1 w-full rounded-md border border-outline bg-surface px-2 py-1.5 text-sm">
              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">App version</span>
            <input value={appVersion} onChange={(e) => setAppVersion(e.target.value)}
              data-testid="eval-version"
              className="mt-1 w-full rounded-md border border-outline bg-surface px-2 py-1.5 font-mono text-sm" />
          </label>
          <label className="text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">Screen</span>
            <input value={screen} onChange={(e) => setScreen(e.target.value)} placeholder="(none)"
              data-testid="eval-screen"
              className="mt-1 w-full rounded-md border border-outline bg-surface px-2 py-1.5 text-sm" />
          </label>
          <div className="flex items-end">
            <button onClick={run} disabled={pending} data-testid="eval-run"
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-on_primary disabled:opacity-50">
              {pending ? "Resolving…" : "Resolve"}
            </button>
          </div>
        </div>

        {result && (
          <div data-testid="eval-result"
            className="mt-4 rounded-md bg-code_background p-4 font-mono text-xs text-code_on_background">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] text-tertiary" aria-hidden>check_circle</span>
              <div className="min-w-0">
                <p>
                  {platform} · app {appVersion}
                  {screen.trim() ? ` · screen ${screen.trim()}` : ""} →{" "}
                  <span className="font-semibold text-tertiary">{JSON.stringify(result.value)}</span>
                </p>
                <p className="mt-1 text-code_on_background/70">
                  {result.source === "condition"
                    ? <>from condition <span className="font-semibold">{result.condition_name}</span> (priority {result.priority})</>
                    : /* Naming the fallback explicitly. "No condition matched" is a RESULT, and
                         leaving it blank is what makes an operator assume the page is broken. */
                      <>no condition matched — serving the parameter default</>}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
