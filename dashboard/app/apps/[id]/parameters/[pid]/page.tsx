export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { OverrideEditor, RemoveOverrideButton } from "@/components/ParameterControls"
import { LiveEvaluator } from "@/components/LiveEvaluator"
import { describePredicate, type Predicate } from "@/lib/predicate"
import { Code } from "@/components/Surface"
import type { ParameterType } from "@/app/apps/[id]/parameters/actions"

const TYPE_STYLE: Record<string, string> = {
  boolean: "bg-primary_container text-on_primary_container border-primary/20",
  number: "bg-secondary_container text-on_secondary_container border-outline_variant",
  string: "bg-tertiary_container text-on_tertiary_container border-tertiary/20",
  json: "bg-warning_container text-on_warning_container border-warning/20",
}

export default async function ParameterEditPage({
  params,
}: {
  params: { id: string; pid: string }
}) {
  const { supabase } = await requireUser()

  const [{ data: parameter }, { data: conditions }, { data: overrides }] = await Promise.all([
    supabase.from("parameter").select("id, key, type, default_value, description, updated_at")
      .eq("id", params.pid).maybeSingle(),
    supabase.from("condition").select("id, name, predicate").eq("app_id", params.id).order("priority"),
    supabase.from("parameter_value").select("id, condition_id, value, priority")
      .eq("parameter_id", params.pid).order("priority"),
  ])

  if (!parameter) {
    return (
      <div className="p-6">
        <h1 className="font-headline text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-secondary">No parameter with that id is available to you.</p>
        <Link href={`/apps/${params.id}/parameters`} className="mt-4 inline-block text-sm text-primary underline">
          ← parameters
        </Link>
      </div>
    )
  }

  const conds = conditions ?? []
  const ovr = overrides ?? []
  const predicateOf = (id: string) =>
    describePredicate(conds.find((c) => c.id === id)?.predicate as Predicate | undefined)
  const nameOf = (id: string) => conds.find((c) => c.id === id)?.name ?? "(deleted condition)"

  return (
    <div className="p-6">
      <Link href={`/apps/${params.id}/parameters`} className="text-sm text-secondary hover:text-on_surface">
        ← parameters
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold tracking-tight">{parameter.key}</h1>
        <span className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${TYPE_STYLE[parameter.type] ?? ""}`}>
          {parameter.type}
        </span>
      </div>
      <p className="mt-1 text-sm text-secondary">
        {parameter.description ?? "No description."}
      </p>

      {/* The evaluator's contract, stated where the rules are edited. Operators reason about
          "which one wins", and the honest answer — explicit priority, default when none match,
          exactly one value per device — is short enough to just say. */}
      <div className="mt-5 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm text-on_surface_variant">
        <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>info</span>
        <p>
          <strong className="font-semibold text-on_surface">Deterministic evaluation.</strong>{" "}
          Overrides are checked in priority order, lowest first, and the first matching condition
          wins — so a device receives exactly one value. If none match, the default below is
          served.
        </p>
      </div>

      <section className="mt-6 overflow-hidden rounded-lg border border-outline_variant bg-surface">
        <header className="flex items-center justify-between gap-4 border-b border-outline_variant px-5 py-3">
          <h2 className="font-headline text-sm font-semibold">Evaluation precedence</h2>
          <span className="font-mono text-[11px] text-secondary">top-to-bottom</span>
        </header>

        <ol className="divide-y divide-outline_variant">
          {ovr.map((o) => (
            <li key={o.id} data-testid="precedence-row" className="flex items-start gap-4 px-5 py-3">
              <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-primary_container font-mono text-[11px] font-bold text-on_primary_container">
                {o.priority}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{nameOf(o.condition_id)}</p>
                <p className="mt-0.5 font-mono text-xs text-secondary">{predicateOf(o.condition_id)}</p>
              </div>
              <Code>{JSON.stringify(o.value)}</Code>
              <RemoveOverrideButton appId={params.id} overrideId={o.id} />
            </li>
          ))}

          {/* The default is rendered as the LAST row of the same list, not as a separate field.
              It is the final branch of one decision, and showing it anywhere else invites the
              reading that it applies alongside the overrides rather than after them. */}
          <li className="flex items-start gap-4 bg-surface_variant/50 px-5 py-3">
            <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-secondary_container font-mono text-[10px] font-bold text-on_secondary_container">
              DEF
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Default</p>
              <p className="mt-0.5 text-xs text-secondary">Served when no condition above matches.</p>
            </div>
            <Code>{JSON.stringify(parameter.default_value)}</Code>
          </li>
        </ol>
      </section>

      <LiveEvaluator parameterId={parameter.id} />

      <OverrideEditor
        appId={params.id}
        parameterId={parameter.id}
        type={parameter.type as ParameterType}
        conditions={conds.map((c) => ({ id: c.id, name: c.name }))}
        overrides={ovr}
      />

      <p className="mt-6 text-sm text-secondary">
        Nothing here reaches a device until you{" "}
        <Link href={`/apps/${params.id}/publish`} className="font-medium text-primary underline">publish</Link>.
      </p>
    </div>
  )
}
