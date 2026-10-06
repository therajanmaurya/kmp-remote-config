// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in. This is
// not a preference — without it the deploy fails listing this file.
export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { AdoptTemplateButton } from "@/components/AdoptTemplateButton"

export default async function CommunityPage() {
  const { supabase } = await requireUser()

  // template_select exposes community rows to every signed-in operator; no app scoping
  // here on purpose. Adoption COPIES (fork_template), so nothing below references these
  // rows directly.
  const { data: templates } = await supabase
    .from("template")
    .select("id, display_name, description, renders_ui, allowed_displays, author_label, shared_at")
    .eq("visibility", "community")
    .order("shared_at", { ascending: false })

  const { data: apps } = await supabase
    .from("app")
    .select("id, display_name")
    .order("display_name")

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">← all apps</Link>
      <h1 className="mt-2 text-xl font-semibold">Community templates</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-500">
        Templates other operators chose to share. Adding one copies it into your app — the
        original keeps working even if its author later withdraws it, and your copy stays
        private unless you share it yourself.
      </p>

      {!templates?.length ? (
        <p className="mt-6 rounded border border-dashed p-8 text-center text-sm text-neutral-500">
          Nothing shared yet.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {templates.map((t) => (
            <li key={t.id} className="rounded border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{t.display_name}</p>
                  <p className="mt-0.5 text-sm text-neutral-500">{t.description}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {t.author_label ? `by ${t.author_label}` : "no attribution"}
                    {" · "}
                    {t.renders_ui ? t.allowed_displays.join(" / ") : "value only"}
                  </p>
                </div>
                <div className="w-56 shrink-0">
                  <AdoptTemplateButton templateId={t.id} apps={apps ?? []} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
