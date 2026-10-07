export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { RollbackButton } from "@/components/PublishControls"

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
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-neutral-500 hover:underline">← app</Link>
      <h1 className="mt-4 text-xl font-semibold">Activity &amp; version history</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {versions.length === 0
          ? "Nothing published yet."
          : `${versions.length} published ${versions.length === 1 ? "revision" : "revisions"}. Every revision is immutable.`}
      </p>

      {versions.length > 0 && (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-2 font-medium">Version</th>
              <th className="py-2 font-medium">Published</th>
              <th className="py-2 font-medium">Configs</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version} data-testid="version-row" className="border-b last:border-0">
                <td className="py-3">
                  <span className="font-mono">v{v.version}</span>
                  {v.version === live && (
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Live
                    </span>
                  )}
                  {v.rolled_back_from !== null && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                      rollback of v{v.rolled_back_from}
                    </span>
                  )}
                </td>
                <td className="py-3 text-neutral-600">
                  {new Date(v.published_at).toLocaleString()}
                </td>
                <td className="py-3 text-neutral-600">{entryCount(v.content)}</td>
                <td className="py-3">
                  {/* No rollback on the live version: it is already what devices receive, so
                      the button would publish an identical snapshot and read as a no-op. */}
                  {v.version === live
                    ? <span className="text-xs text-neutral-400">current</span>
                    : <RollbackButton appId={params.id} version={v.version} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-8 rounded border bg-neutral-50 p-4 text-sm text-neutral-600">
        <strong className="font-medium">Rollback is forward-only.</strong> Rolling back to v3
        publishes a <em>new</em> version carrying v3&apos;s content; the version being undone stays
        in this list. A history that erased its own mistakes could not answer what was live, and when.
      </p>
    </main>
  )
}
