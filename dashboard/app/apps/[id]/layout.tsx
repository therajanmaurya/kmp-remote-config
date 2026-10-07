export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { getPublishStatus } from "@/lib/publish-status"
import { UnpublishedPill } from "@/components/UnpublishedPill"

/**
 * Chrome for every route under an app. The pill lives here rather than on the publish page
 * because its whole job is to be seen by someone who is NOT thinking about publishing.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const { supabase } = await requireUser()
  const { staged, liveVersion } = await getPublishStatus(supabase, params.id)

  return (
    <>
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-2">
          <div className="flex items-center gap-3 text-sm text-neutral-500">
            <Link href={`/apps/${params.id}`} className="hover:underline">App</Link>
            <Link href={`/apps/${params.id}/parameters`} className="hover:underline">Parameters</Link>
            <Link href={`/apps/${params.id}/conditions`} className="hover:underline">Conditions</Link>
            <Link href={`/apps/${params.id}/preview`} className="hover:underline">Preview</Link>
            <Link href={`/apps/${params.id}/history`} className="hover:underline">Activity</Link>
            <span className="text-neutral-300">·</span>
            <span>{liveVersion ? `v${liveVersion} live` : "never published"}</span>
          </div>
          <UnpublishedPill appId={params.id} count={staged.length} />
        </div>
      </div>
      {children}
    </>
  )
}
