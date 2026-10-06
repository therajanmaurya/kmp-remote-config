// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in. This is
// not a preference — without it the deploy fails listing this file.
export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { ImpressionChart, type DayCount } from "@/components/ImpressionChart"

export default async function AppOverviewPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  const { data: app } = await supabase
    .from("app")
    .select("id, slug, display_name, platforms")
    .eq("id", params.id)
    .maybeSingle()

  // A missing row here means the policy filtered it — the app does not exist for this
  // caller. Saying so without distinguishing "gone" from "not yours" is deliberate: the
  // alternative is an existence oracle over another tenant's ids.
  if (!app) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-neutral-500">
          No app with that id is available to you.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-neutral-700 hover:underline">
          ← all apps
        </Link>
      </main>
    )
  }

  const [{ count: activeCount }, { count: keyCount }, { data: impressions }] = await Promise.all([
    supabase.from("config").select("id", { count: "exact", head: true })
      .eq("app_id", params.id).eq("is_enabled", true),
    supabase.from("app_key").select("id", { count: "exact", head: true })
      .eq("app_id", params.id).is("revoked_at", null),
    supabase.from("impression").select("created_at")
      .eq("app_id", params.id)
      .gte("created_at", new Date(Date.now() - 14 * 864e5).toISOString()),
  ])

  // Bucket by day in app code rather than SQL: the rows are already scoped and small, and
  // a date_trunc RPC would need its own grant + its own REVOKE/GRANT pair (the 007 lesson).
  const byDay = new Map<string, number>()
  for (const r of impressions ?? []) {
    const d = String(r.created_at).slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  const chart: DayCount[] = [...byDay.entries()].sort().map(([day, count]) => ({ day: day.slice(5), count }))

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">← all apps</Link>
      <h1 className="mt-2 text-xl font-semibold">{app.display_name}</h1>
      <p className="font-mono text-xs text-neutral-500">{app.slug}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Link href={`/apps/${params.id}/configs`} className="rounded border p-4 hover:border-neutral-400">
          <p className="text-2xl font-semibold">{activeCount ?? 0}</p>
          <p className="text-xs text-neutral-500">active configs</p>
        </Link>
        <Link href={`/apps/${params.id}/keys`} className="rounded border p-4 hover:border-neutral-400">
          <p className="text-2xl font-semibold">{keyCount ?? 0}</p>
          <p className="text-xs text-neutral-500">live keys</p>
        </Link>
        <Link href={`/apps/${params.id}/templates`} className="rounded border p-4 hover:border-neutral-400">
          <p className="text-2xl font-semibold">·</p>
          <p className="text-xs text-neutral-500">custom templates</p>
        </Link>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Impressions — last 14 days
      </h2>
      <div className="mt-3"><ImpressionChart data={chart} /></div>
    </main>
  )
}
