export const runtime = "edge"

import { requireUser } from "@/lib/require-user"
import { getPublishStatus } from "@/lib/publish-status"
import { loadAppList } from "@/lib/fleet"
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

  return (
    <Shell
      userEmail={user.email ?? null}
      apps={apps}
      app={{
        id: params.id,
        name: app?.display_name ?? "App",
        liveVersion: status.liveVersion,
        stagedCount: status.staged.length,
      }}
    >
      {children}
    </Shell>
  )
}
