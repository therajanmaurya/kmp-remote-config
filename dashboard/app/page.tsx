// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in. This is
// not a preference — without it the deploy fails listing this file.
export const runtime = "edge"

import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/require-user"

export default async function AppListPage() {
  const { supabase } = await requireUser()

  // No .eq("owner_id", …) on purpose: app_select already restricts this to apps the caller
  // owns or is a member of. Adding a client-side filter would MASK an RLS regression — the
  // negative tests in slice 1 prove isolation, and they can only prove it if the dashboard
  // actually relies on the policy.
  const { data: apps } = await supabase
    .from("app")
    .select("id, slug, display_name, platforms, config(count)")
    .order("created_at", { ascending: false })

  // With exactly one app, the list is a page that always says the same thing and is never the
  // reason anyone opened the dashboard. Go straight to its control plane — the operator
  // reported landing on a chooser with one choice, which is a click that only ever delays them.
  // Two or more apps and the list is doing real work, so it stays.
  if (apps?.length === 1) redirect(`/apps/${apps[0].id}/parameters`)

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Apps</h1>
        <div className="flex items-center gap-3">
          <Link href="/community" className="text-sm text-on_surface_variant hover:underline">
            Community templates
          </Link>
          <Link href="/apps/new" className="rounded bg-primary px-3 py-1.5 text-sm font-semibold text-on_primary">
            New app
          </Link>
        </div>
      </div>

      {!apps?.length ? (
        <div className="mt-10 rounded border border-dashed p-10 text-center">
          <p className="font-medium">No apps yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-secondary">
            An app is one mobile or web product. Create one to issue a key and author your
            first config.
          </p>
          <Link
            href="/apps/new"
            className="mt-4 inline-block rounded bg-primary px-3 py-1.5 text-sm font-semibold text-on_primary"
          >
            Create your first app
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {apps.map((a) => (
            <li key={a.id} className="rounded border p-4 hover:border-outline">
              <Link href={`/apps/${a.id}`} className="block">
                <p className="font-medium">{a.display_name}</p>
                <p className="mt-0.5 font-mono text-xs text-secondary">{a.slug}</p>
                <p className="mt-2 text-xs text-secondary">
                  {a.platforms.join(" · ") || "no platforms"}
                  {" — "}
                  {/* a count aggregate comes back as [{count: n}] */}
                  {(a.config as unknown as { count: number }[])?.[0]?.count ?? 0} configs
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
