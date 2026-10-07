export const runtime = "edge"

import { headers } from "next/headers"
import { requireUser } from "@/lib/require-user"
import { getPublishStatus } from "@/lib/publish-status"
import { AppShell } from "@/components/AppShell"

/** Which sidebar entry to highlight, derived from the path rather than threaded through each page. */
function activeFromPath(pathname: string): string {
  if (pathname.includes("/parameters")) return "Parameters"
  if (pathname.includes("/conditions")) return "Conditions"
  if (pathname.includes("/configs")) return "Configs"
  if (pathname.includes("/templates")) return "Templates"
  if (pathname.includes("/keys")) return "Keys"
  if (pathname.includes("/preview")) return "Preview"
  if (pathname.includes("/history")) return "Activity"
  if (pathname.includes("/publish")) return "Publish"
  return "Overview"
}

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const { supabase } = await requireUser()

  const [{ data: app }, status] = await Promise.all([
    supabase.from("app").select("display_name").eq("id", params.id).maybeSingle(),
    getPublishStatus(supabase, params.id),
  ])

  // `x-invoke-path` is set by Next on the edge runtime; `x-pathname` by our middleware. Either
  // way a miss only costs the highlight, never the page.
  const h = headers()
  const pathname = h.get("x-pathname") ?? h.get("x-invoke-path") ?? ""

  return (
    <AppShell
      appId={params.id}
      appName={app?.display_name ?? "App"}
      active={activeFromPath(pathname)}
      liveVersion={status.liveVersion}
      stagedCount={status.staged.length}
    >
      {children}
    </AppShell>
  )
}
