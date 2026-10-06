import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { DuplicateButton, EnableSwitch } from "@/components/ConfigRowControls"

export default async function ConfigListPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  const { data: configs } = await supabase
    .from("config")
    .select("id, template_id, display, screens, platforms, min_app_version, max_app_version, starts_at, ends_at, priority, is_enabled")
    .eq("app_id", params.id)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })

  const window = (c: { starts_at: string | null; ends_at: string | null }) => {
    if (!c.starts_at && !c.ends_at) return "always"
    const f = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "…")
    return `${f(c.starts_at)} → ${f(c.ends_at)}`
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-neutral-500 hover:underline">← app</Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Configs</h1>
        <Link href={`/apps/${params.id}/configs/new`}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">New config</Link>
      </div>

      {!configs?.length ? (
        <p className="mt-6 rounded border border-dashed p-8 text-center text-sm text-neutral-500">
          No configs yet. A new config is saved disabled until you turn it on.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr><th className="py-2">Type</th><th>Display</th><th>Screens</th><th>Window</th><th>Pri</th><th>On</th><th /></tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2">
                    <Link href={`/apps/${params.id}/configs/${c.id}`} className="hover:underline">
                      {c.template_id}
                    </Link>
                  </td>
                  <td className="text-neutral-600">{c.display}</td>
                  <td className="text-neutral-600">{c.screens.length ? c.screens.join(", ") : "all"}</td>
                  <td className="text-neutral-600">{window(c)}</td>
                  <td className="text-neutral-600">{c.priority}</td>
                  <td><EnableSwitch appId={params.id} configId={c.id} initial={c.is_enabled} /></td>
                  <td className="text-right"><DuplicateButton appId={params.id} configId={c.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
