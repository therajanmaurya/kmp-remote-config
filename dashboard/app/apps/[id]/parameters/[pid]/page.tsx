export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { OverrideEditor } from "@/components/ParameterControls"
import type { ParameterType } from "@/app/apps/[id]/parameters/actions"

export default async function ParameterEditPage({
  params,
}: {
  params: { id: string; pid: string }
}) {
  const { supabase } = await requireUser()

  const [{ data: parameter }, { data: conditions }, { data: overrides }] = await Promise.all([
    supabase.from("parameter").select("id, key, type, default_value, description")
      .eq("id", params.pid).maybeSingle(),
    supabase.from("condition").select("id, name").eq("app_id", params.id).order("priority"),
    supabase.from("parameter_value").select("id, condition_id, value, priority")
      .eq("parameter_id", params.pid).order("priority"),
  ])

  if (!parameter) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-neutral-500">No parameter with that id is available to you.</p>
        <Link href={`/apps/${params.id}/parameters`} className="mt-4 inline-block text-sm underline">
          ← parameters
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href={`/apps/${params.id}/parameters`} className="text-sm text-neutral-500 hover:underline">
        ← parameters
      </Link>

      <h1 className="mt-4 font-mono text-xl font-semibold">{parameter.key}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {parameter.description ?? <span className="text-neutral-400">No description.</span>}
      </p>

      <dl className="mt-4 flex gap-8 text-sm">
        <div>
          <dt className="text-xs uppercase text-neutral-500">Type</dt>
          <dd className="mt-1">{parameter.type}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-neutral-500">Default</dt>
          <dd className="mt-1">
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">
              {JSON.stringify(parameter.default_value)}
            </code>
          </dd>
        </div>
      </dl>

      <OverrideEditor
        appId={params.id}
        parameterId={parameter.id}
        type={parameter.type as ParameterType}
        conditions={conditions ?? []}
        overrides={overrides ?? []}
      />

      <p className="mt-8 rounded border bg-neutral-50 p-4 text-sm text-neutral-600">
        Overrides are evaluated lowest priority first and the first match wins — so a device can
        only ever receive one value for this key. Nothing here reaches a device until you{" "}
        <Link href={`/apps/${params.id}/publish`} className="underline">publish</Link>.
      </p>
    </main>
  )
}
