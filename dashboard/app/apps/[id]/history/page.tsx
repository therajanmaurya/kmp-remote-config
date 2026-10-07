export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { RollbackButton } from "@/components/PublishControls"
import { Empty, Hero, Panel, StatCards, Th } from "@/components/Surface"

type VersionRow = {
  version: number
  published_at: string
  published_by: string | null
  rolled_back_from: number | null
  content: unknown
}

/** How many configs the snapshot carries — the one summary that needs no extra query. */
function entryCount(content: unknown): number {
  return Array.isArray(content) ? content.length : 0
}

export default async function HistoryPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  const { data } = await supabase
    .from("config_version")
    .select("version, published_at, published_by, rolled_back_from, content")
    .eq("app_id", params.id)
    .order("version", { ascending: false })

  const versions = (data ?? []) as VersionRow[]
  const live = versions[0]?.version ?? null

  return (
    <div className="p-6">
      <Hero
        eyebrow="Activity · Version history"
        title={`${versions.length} published revision${versions.length === 1 ? "" : "s"}`}
        subtitle="An immutable audit trail. Every revision is retained, and a rollback publishes a new revision rather than erasing one."
      />

      <StatCards
        stats={[
          { label: "Live version", value: live ? `v${live}` : "—", hint: live ? "serving devices" : "never published" },
          { label: "Revisions", value: String(versions.length) },
          { label: "Rollbacks", value: String(versions.filter((v) => v.rolled_back_from !== null).length) },
          { label: "Configs live", value: String(entryCount(versions[0]?.content)) },
        ]}
      />

      <Panel title="Version history">
        {versions.length === 0 ? (
          <Empty>Nothing published yet. Publishing takes a snapshot of every enabled config.</Empty>
        ) : (
        <table className="w-full">
          <thead className="border-b border-outline_variant bg-surface_variant/50">
            <tr><Th>Version</Th><Th>Published</Th><Th>Configs</Th><Th>Actions</Th></tr>
          </thead>
          <tbody className="divide-y divide-outline_variant">
            {versions.map((v) => (
              <tr key={v.version} data-testid="version-row" className="hover:bg-surface_variant/40">
                <td className="px-5 py-3">
                  <span className="font-mono text-sm font-semibold">v{v.version}</span>
                  {v.version === live && (
                    <span className="ml-2 rounded-full bg-tertiary_container px-2 py-0.5 text-[11px] font-semibold text-on_tertiary_container">
                      Live
                    </span>
                  )}
                  {v.rolled_back_from !== null && (
                    <span className="ml-2 rounded-full bg-secondary_container px-2 py-0.5 text-[11px] font-medium text-on_secondary_container">
                      rollback of v{v.rolled_back_from}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-on_surface_variant">
                  {new Date(v.published_at).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-sm text-on_surface_variant">{entryCount(v.content)}</td>
                <td className="px-5 py-3">
                  {/* No rollback on the live version: it is already what devices receive, so
                      the button would publish an identical snapshot and read as a no-op. */}
                  {v.version === live
                    ? <span className="text-xs text-secondary">current</span>
                    : <RollbackButton appId={params.id} version={v.version} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </Panel>

      <div className="mt-6 flex gap-3 rounded-lg border border-outline_variant bg-surface p-4 text-sm text-on_surface_variant">
        <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden>history</span>
        <p>
          <strong className="font-semibold text-on_surface">Rollback is forward-only.</strong>{" "}
          Rolling back to v3 publishes a <em>new</em> version carrying v3&apos;s content; the version
          being undone stays in this list. A history that erased its own mistakes could not answer
          what was live, and when.
        </p>
      </div>
    </div>
  )
}
