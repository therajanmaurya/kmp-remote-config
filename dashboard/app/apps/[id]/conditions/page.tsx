export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { describePredicate, type Predicate } from "@/lib/predicate"
import { DeleteConditionButton, NewConditionForm } from "@/components/ConditionControls"
import { Code, Empty, Hero, Panel, StatCards, Th } from "@/components/Surface"

type Row = {
  id: string
  name: string
  predicate: Predicate
  priority: number
  parameter_value: { count: number }[]
}

export default async function ConditionsPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  // The usage count is fetched with the row, not separately: it is the most important column
  // on this page. A named condition only earns its name if you can see what it affects.
  const { data } = await supabase
    .from("condition")
    .select("id, name, predicate, priority, parameter_value(count)")
    .eq("app_id", params.id)
    .order("priority")

  const conditions = (data ?? []) as unknown as Row[]
  const attached = conditions.filter((c) => (c.parameter_value?.[0]?.count ?? 0) > 0).length
  const totalUses = conditions.reduce((n, c) => n + (c.parameter_value?.[0]?.count ?? 0), 0)

  return (
    <div className="p-6">
      <Hero
        eyebrow="Targeting engine · Conditions"
        title={`${conditions.length} named rule${conditions.length === 1 ? "" : "s"}`}
        subtitle="Describe an audience once and reuse it. A parameter stores a reference to a condition, never a copy of its rule."
      />

      <StatCards
        stats={[
          { label: "Conditions", value: String(conditions.length) },
          { label: "In use", value: String(attached), hint: "attached to a parameter" },
          { label: "Parameter attachments", value: String(totalUses) },
          {
            label: "Unattached",
            value: String(conditions.length - attached),
            hint: "usually a half-finished change",
          },
        ]}
      />

      <Panel title="Conditions" action={<NewConditionForm appId={params.id} />}>
        {conditions.length === 0 ? (
          <Empty>
            No conditions yet. A condition describes an audience — &ldquo;Android beta
            users&rdquo;, &ldquo;EU region&rdquo; — and parameters use it to vary their value.
          </Empty>
        ) : (
          <table className="w-full">
            <thead className="border-b border-outline_variant bg-surface_variant/50">
              <tr><Th>Name</Th><Th>Rule</Th><Th>Used by</Th><Th>Priority</Th><Th /></tr>
            </thead>
            <tbody className="divide-y divide-outline_variant">
              {conditions.map((c) => {
                const usedBy = c.parameter_value?.[0]?.count ?? 0
                return (
                  <tr key={c.id} data-testid="condition-row" className="align-top hover:bg-surface_variant/40">
                    <td className="px-5 py-3 text-sm font-semibold">{c.name}</td>
                    <td className="px-5 py-3">
                      {/* Plain language, not raw JSON: showing the object would make every
                          condition look alike at a glance, which is the one thing a
                          reusable-condition list cannot afford. */}
                      <Code>{describePredicate(c.predicate)}</Code>
                    </td>
                    <td className="px-5 py-3">
                      {usedBy === 0 ? (
                        <span className="text-xs text-secondary">not attached yet</span>
                      ) : (
                        <Link href={`/apps/${params.id}/parameters`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          {usedBy} parameter{usedBy === 1 ? "" : "s"}
                          <span className="material-symbols-outlined text-[14px]" aria-hidden>open_in_new</span>
                        </Link>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="rounded bg-warning_container px-2 py-0.5 font-mono text-[11px] font-semibold text-on_warning_container">
                        {c.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <DeleteConditionButton appId={params.id} conditionId={c.id} name={c.name} usedBy={usedBy} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="mt-6 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm text-on_surface_variant">
        <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>info</span>
        <p>
          <strong className="font-semibold text-on_surface">Edit once, change everywhere.</strong>{" "}
          Editing a condition updates every parameter that references it — that reuse is the whole
          reason conditions are named.
        </p>
      </div>
    </div>
  )
}
