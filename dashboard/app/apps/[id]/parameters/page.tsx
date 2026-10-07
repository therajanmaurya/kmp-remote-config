export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { DeleteParameterButton, NewParameterForm } from "@/components/ParameterControls"
import { Code, Empty, Hero, Panel, StatCards, Th } from "@/components/Surface"

type Row = {
  id: string
  key: string
  type: string
  default_value: unknown
  description: string | null
  parameter_value: { count: number }[]
}

const TYPE_STYLE: Record<string, string> = {
  boolean: "bg-primary_container text-on_primary_container border-primary/20",
  number: "bg-secondary_container text-on_secondary_container border-outline_variant",
  string: "bg-tertiary_container text-on_tertiary_container border-tertiary/20",
  json: "bg-warning_container text-on_warning_container border-warning/20",
}

export default async function ParametersPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  const { data } = await supabase
    .from("parameter")
    .select("id, key, type, default_value, description, parameter_value(count)")
    .eq("app_id", params.id)
    .order("key")

  const parameters = (data ?? []) as unknown as Row[]
  const withOverrides = parameters.filter((p) => (p.parameter_value?.[0]?.count ?? 0) > 0).length
  const { count: conditionCount } = await supabase
    .from("condition").select("id", { count: "exact", head: true }).eq("app_id", params.id)

  return (
    <div className="p-6">
      <Hero
        eyebrow="Control plane · Parameters"
        title={`${parameters.length} parameter${parameters.length === 1 ? "" : "s"}`}
        subtitle="Typed values your app reads. Each has a default, and can vary by audience through a named condition."
      />

      <StatCards
        stats={[
          { label: "Parameters", value: String(parameters.length) },
          { label: "With overrides", value: String(withOverrides), hint: "vary by audience" },
          { label: "Conditions available", value: String(conditionCount ?? 0) },
          {
            label: "Default for everyone",
            value: String(parameters.length - withOverrides),
            hint: "no condition attached",
          },
        ]}
      />

      <Panel title="Parameters" action={<NewParameterForm appId={params.id} />}>
        {parameters.length === 0 ? (
          <Empty>
            No parameters yet. A parameter is a single typed value — a feature flag, a limit, a
            theme name — that your app reads with <Code>getBoolean</Code>, <Code>getLong</Code> or{" "}
            <Code>getString</Code>.
          </Empty>
        ) : (
          <table className="w-full">
            <thead className="border-b border-outline_variant bg-surface_variant/50">
              <tr><Th>Key</Th><Th>Type</Th><Th>Default</Th><Th>Conditions</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-outline_variant">
              {parameters.map((p) => {
                const overrides = p.parameter_value?.[0]?.count ?? 0
                return (
                  <tr key={p.id} data-testid="parameter-row" className="hover:bg-surface_variant/40">
                    <td className="px-5 py-3">
                      <Link href={`/apps/${params.id}/parameters/${p.id}`}
                        className="font-mono text-sm font-medium text-primary hover:underline">
                        {p.key}
                      </Link>
                      {p.description && <p className="mt-0.5 text-xs text-secondary">{p.description}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${TYPE_STYLE[p.type] ?? ""}`}>
                        {p.type}
                      </span>
                    </td>
                    <td className="px-5 py-3"><Code>{JSON.stringify(p.default_value)}</Code></td>
                    <td className="px-5 py-3 text-sm">
                      {overrides === 0
                        ? <span className="text-xs text-secondary">default for everyone</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                            <span className="material-symbols-outlined text-[14px]" aria-hidden>rule</span>
                            {overrides} condition{overrides === 1 ? "" : "s"}
                          </span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <DeleteParameterButton appId={params.id} parameterId={p.id} keyName={p.key} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <p className="mt-6 text-sm text-secondary">
        Changes go live when you <Link href={`/apps/${params.id}/publish`} className="font-medium text-primary underline">publish</Link>.
        Check what a device will receive in the{" "}
        <Link href={`/apps/${params.id}/preview`} className="font-medium text-primary underline">preview</Link>.
      </p>
    </div>
  )
}
