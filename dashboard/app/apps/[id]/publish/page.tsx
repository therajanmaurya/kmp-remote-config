export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { getPublishStatus, type StagedChange } from "@/lib/publish-status"
import { PublishButton } from "@/components/PublishControls"

const KIND_STYLE: Record<StagedChange["kind"], string> = {
  new: "border-green-300 bg-green-50 text-green-800",
  modified: "border-amber-300 bg-amber-50 text-amber-900",
  removed: "border-red-300 bg-red-50 text-red-800",
}

function Value({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded bg-neutral-900 p-3 text-xs leading-relaxed text-neutral-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export default async function PublishPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()
  const { staged, liveVersion } = await getPublishStatus(supabase, params.id)

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-neutral-500 hover:underline">← app</Link>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold">
            {staged.length === 0
              ? "Nothing staged"
              : `Ready to deploy: ${staged.length} staged ${staged.length === 1 ? "change" : "changes"}`}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {liveVersion
              ? `Devices are currently receiving v${liveVersion}.`
              : "This app has never published, so devices receive nothing yet."}
          </p>
        </div>
        <PublishButton appId={params.id} count={staged.length} />
      </div>

      {staged.length === 0 ? (
        <p className="mt-8 rounded border border-dashed p-6 text-center text-sm text-neutral-500">
          Every enabled config matches what is live. Edit a config to stage a change.
        </p>
      ) : (
        <section className="mt-8 space-y-4">
          <h2 className="text-sm font-medium text-neutral-700">Review before publishing</h2>
          {staged.map((c) => (
            <article key={c.id} data-testid="staged-change" className="rounded border">
              <header className="flex items-center gap-3 border-b px-4 py-2">
                <span className={`rounded border px-2 py-0.5 text-xs font-medium uppercase ${KIND_STYLE[c.kind]}`}>
                  {c.kind}
                </span>
                <span className="font-mono text-sm">{c.label}</span>
                <span className="ml-auto font-mono text-xs text-neutral-400">{c.id.slice(0, 8)}</span>
              </header>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-neutral-500">Currently live</p>
                  {c.before === null
                    ? <p className="rounded border border-dashed p-3 text-xs text-neutral-400">not on devices</p>
                    : <Value value={c.before} />}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-neutral-500">After publish</p>
                  {c.after === null
                    ? <p className="rounded border border-dashed p-3 text-xs text-neutral-400">removed from devices</p>
                    : <Value value={c.after} />}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
