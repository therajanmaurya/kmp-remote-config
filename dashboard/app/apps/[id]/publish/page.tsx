export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { getPublishStatus, type StagedChange } from "@/lib/publish-status"
import { PublishButton } from "@/components/PublishControls"
import { Hero, Panel, StatCards } from "@/components/Surface"

const KIND_STYLE: Record<StagedChange["kind"], string> = {
  new: "border-tertiary/30 bg-tertiary_container text-on_tertiary_container",
  modified: "border-warning/30 bg-warning_container text-on_warning_container",
  removed: "border-error/30 bg-error_container text-on_error_container",
}

function Value({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-code_background p-3 font-mono text-xs leading-relaxed text-code_on_background">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export default async function PublishPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()
  const { staged, liveVersion } = await getPublishStatus(supabase, params.id)

  return (
    <div className="p-6">
      <Hero
        eyebrow="Review & publish"
        title={staged.length === 0
          ? "Nothing staged"
          : `Ready to deploy: ${staged.length} staged ${staged.length === 1 ? "change" : "changes"}`}
        subtitle={liveVersion
          ? `Devices are currently receiving v${liveVersion}. Nothing here reaches them until you publish.`
          : "This app has never published, so devices receive nothing yet."}
        aside={<PublishButton appId={params.id} count={staged.length} />}
      />

      <StatCards
        stats={[
          { label: "Staged changes", value: String(staged.length) },
          { label: "New", value: String(staged.filter((c) => c.kind === "new").length) },
          { label: "Modified", value: String(staged.filter((c) => c.kind === "modified").length) },
          { label: "Removed", value: String(staged.filter((c) => c.kind === "removed").length) },
        ]}
      />

      {staged.length === 0 ? (
        <p className="mt-6 rounded-lg border border-outline_variant bg-surface p-10 text-center text-sm text-secondary">
          Every enabled config matches what is live. Edit a config to stage a change.
        </p>
      ) : (
        <section className="mt-6 space-y-4">
          <h2 className="font-headline text-sm font-semibold">Review before publishing</h2>
          {staged.map((c) => (
            <article key={c.id} data-testid="staged-change"
              className="overflow-hidden rounded-lg border border-outline_variant bg-surface">
              <header className="flex items-center gap-3 border-b border-outline_variant bg-surface_variant/50 px-4 py-2.5">
                <span className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase ${KIND_STYLE[c.kind]}`}>
                  {c.kind}
                </span>
                <span className="font-mono text-sm">{c.label}</span>
                <span className="ml-auto font-mono text-xs text-secondary">{c.id.slice(0, 8)}</span>
              </header>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">Currently live</p>
                  {c.before === null
                    ? <p className="rounded-md border border-dashed border-outline p-3 text-xs text-secondary">not on devices</p>
                    : <Value value={c.before} />}
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">After publish</p>
                  {c.after === null
                    ? <p className="rounded-md border border-dashed border-outline p-3 text-xs text-secondary">removed from devices</p>
                    : <Value value={c.after} />}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
