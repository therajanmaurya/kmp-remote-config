// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in. This is
// not a preference — without it the deploy fails listing this file.
export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { ShareControl } from "@/components/ShareTemplateDialog"

export default async function TemplatesPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  // This app's OWN templates only — builtins are global and listed on the authoring screen.
  const { data: templates } = await supabase
    .from("template")
    .select("id, display_name, description, renders_ui, visibility, shared_at, author_label, forked_from")
    .eq("app_id", params.id)
    .order("created_at", { ascending: false })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-secondary hover:underline">← app</Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Custom templates</h1>
        <div className="flex items-center gap-3">
          <Link href="/community" className="text-sm text-on_surface_variant hover:underline">Browse community</Link>
          <Link href={`/apps/${params.id}/templates/new`}
            className="rounded bg-primary px-3 py-1.5 text-sm font-semibold text-on_primary">New template</Link>
        </div>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-secondary">
        A template defines the fields an operator fills in to author a config. Yours are
        private to this app until you choose to share them.
      </p>

      {!templates?.length ? (
        <p className="mt-6 rounded border border-dashed p-8 text-center text-sm text-secondary">
          No custom templates yet. The 15 built-in types are always available when authoring.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {templates.map((t) => (
            <li key={t.id} className="rounded border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{t.display_name}</p>
                  <p className="mt-0.5 text-sm text-secondary">{t.description}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs">
                    <span data-testid="visibility" className={`rounded px-2 py-0.5 ${
                      t.visibility === "community" ? "bg-blue-100 text-blue-900" : "bg-surface_variant text-on_surface_variant"
                    }`}>
                      {t.visibility}
                    </span>
                    {!t.renders_ui && <span className="text-secondary">value only</span>}
                    {t.forked_from && (
                      <span className="font-mono text-secondary">forked from {t.forked_from}</span>
                    )}
                  </p>
                </div>
                <div className="w-64 shrink-0">
                  <ShareControl appId={params.id} templateId={t.id}
                    shared={t.visibility === "community"} sharedAt={t.shared_at}
                    authorLabel={t.author_label} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
