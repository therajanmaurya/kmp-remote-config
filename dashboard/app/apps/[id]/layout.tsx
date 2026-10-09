export const runtime = "edge"

import { headers } from "next/headers"
import { requireUser } from "@/lib/require-user"
import { getPublishStatus } from "@/lib/publish-status"
import { loadAppList } from "@/lib/fleet"
import { resolveSection } from "@/lib/app-section"
import { Shell } from "@/components/Shell"

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const { user, supabase } = await requireUser()

  const [{ data: app }, status, apps] = await Promise.all([
    supabase.from("app").select("display_name").eq("id", params.id).maybeSingle(),
    getPublishStatus(supabase, params.id),
    loadAppList(supabase),
  ])

  // `x-invoke-path` is set by Next on the edge runtime; `x-pathname` by our middleware. Either
  // way a miss only costs the highlight, never the page.
  const h = headers()
  const pathname = h.get("x-pathname") ?? h.get("x-invoke-path") ?? ""
  const hit = resolveSection(pathname)

  return (
    <Shell
      active={hit?.label ?? "Overview"}
      userEmail={user.email ?? null}
      apps={apps}
      app={{
        id: params.id,
        name: app?.display_name ?? "App",
        liveVersion: status.liveVersion,
        stagedCount: status.staged.length,
        // Switching apps keeps you on the same section — comparing the same surface across two
        // apps is the usual reason to switch.
        section: hit?.section ?? null,
      }}
    >
      {children}
    </Shell>
  )
}
