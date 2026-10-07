export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { DeleteParameterButton, NewParameterForm } from "@/components/ParameterControls"

type Row = {
  id: string
  key: string
  type: string
  default_value: unknown
  description: string | null
  parameter_value: { count: number }[]
}

const TYPE_STYLE: Record<string, string> = {
  boolean: "bg-purple-50 text-purple-700 border-purple-200",
  number: "bg-blue-50 text-blue-700 border-blue-200",
  string: "bg-green-50 text-green-700 border-green-200",
  json: "bg-amber-50 text-amber-800 border-amber-200",
}

export default async function ParametersPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  const { data } = await supabase
    .from("parameter")
    .select("id, key, type, default_value, description, parameter_value(count)")
    .eq("app_id", params.id)
    .order("key")

  const parameters = (data ?? []) as unknown as Row[]

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-neutral-500 hover:underline">← app</Link>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold">Parameters</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Typed values your app reads. Each has a default, and can vary by audience through a
            condition.
          </p>
        </div>
        <NewParameterForm appId={params.id} />
      </div>

      {parameters.length === 0 ? (
        <p className="mt-8 rounded border border-dashed p-6 text-center text-sm text-neutral-500">
          No parameters yet. A parameter is a single typed value — a feature flag, a limit, a theme
          name — that your app reads with <code className="font-mono">getBoolean</code>,{" "}
          <code className="font-mono">getLong</code> or <code className="font-mono">getString</code>.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Default</th>
              <th className="py-2 font-medium">Overrides</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((p) => {
              const overrides = p.parameter_value?.[0]?.count ?? 0
              return (
                <tr key={p.id} data-testid="parameter-row" className="border-b last:border-0">
                  <td className="py-3">
                    <Link href={`/apps/${params.id}/parameters/${p.id}`} className="font-mono hover:underline">
                      {p.key}
                    </Link>
                    {p.description && <p className="text-xs text-neutral-500">{p.description}</p>}
                  </td>
                  <td className="py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs ${TYPE_STYLE[p.type] ?? ""}`}>
                      {p.type}
                    </span>
                  </td>
                  <td className="py-3">
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">
                      {JSON.stringify(p.default_value)}
                    </code>
                  </td>
                  <td className="py-3 text-neutral-600">
                    {overrides === 0
                      ? <span className="text-xs text-neutral-400">default for everyone</span>
                      : <span className="text-xs">{overrides} condition{overrides === 1 ? "" : "s"}</span>}
                  </td>
                  <td className="py-3">
                    <DeleteParameterButton appId={params.id} parameterId={p.id} keyName={p.key} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="mt-8 text-sm text-neutral-500">
        Changes here go live when you <Link href={`/apps/${params.id}/publish`} className="underline">publish</Link>,
        and you can check what a given device will receive in the{" "}
        <Link href={`/apps/${params.id}/preview`} className="underline">preview</Link>.
      </p>
    </main>
  )
}
