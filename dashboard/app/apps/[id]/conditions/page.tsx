export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { describePredicate, type Predicate } from "@/lib/predicate"
import { DeleteConditionButton, NewConditionForm } from "@/components/ConditionControls"

type Row = {
  id: string
  name: string
  predicate: Predicate
  priority: number
  parameter_value: { count: number }[]
}

export default async function ConditionsPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  // The usage count is fetched with the row, not separately: it is the single most important
  // column on this page. A named condition only earns its name if you can see what it affects.
  const { data } = await supabase
    .from("condition")
    .select("id, name, predicate, priority, parameter_value(count)")
    .eq("app_id", params.id)
    .order("priority")

  const conditions = (data ?? []) as unknown as Row[]

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-neutral-500 hover:underline">← app</Link>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold">Conditions</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Named audience rules. Define one once and attach it to as many parameters as you like.
          </p>
        </div>
        <NewConditionForm appId={params.id} />
      </div>

      {conditions.length === 0 ? (
        <p className="mt-8 rounded border border-dashed p-6 text-center text-sm text-neutral-500">
          No conditions yet. A condition describes an audience — &ldquo;Android beta users&rdquo;,
          &ldquo;EU region&rdquo; — and parameters use it to vary their value.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Rule</th>
              <th className="py-2 font-medium">Used by</th>
              <th className="py-2 font-medium">Priority</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((c) => {
              const usedBy = c.parameter_value?.[0]?.count ?? 0
              return (
                <tr key={c.id} data-testid="condition-row" className="border-b last:border-0 align-top">
                  <td className="py-3 font-medium">{c.name}</td>
                  <td className="py-3 text-neutral-600">
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                      {describePredicate(c.predicate)}
                    </code>
                  </td>
                  <td className="py-3">
                    {usedBy === 0 ? (
                      // Worth surfacing rather than showing 0 quietly: an unused condition is
                      // usually a half-finished change, not a deliberate state.
                      <span className="text-xs text-neutral-400">not attached yet</span>
                    ) : (
                      <Link href={`/apps/${params.id}/parameters`} className="text-xs underline">
                        {usedBy} parameter{usedBy === 1 ? "" : "s"}
                      </Link>
                    )}
                  </td>
                  <td className="py-3 text-neutral-600">{c.priority}</td>
                  <td className="py-3">
                    <DeleteConditionButton appId={params.id} conditionId={c.id} name={c.name} usedBy={usedBy} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="mt-8 rounded border bg-neutral-50 p-4 text-sm text-neutral-600">
        <strong className="font-medium">Edit once, change everywhere.</strong> A parameter stores a
        reference to a condition, never a copy of its rule — so editing &ldquo;Android beta
        users&rdquo; updates every parameter that uses it. That reuse is the whole reason conditions
        are named.
      </p>
    </main>
  )
}
