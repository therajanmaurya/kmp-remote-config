// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in. This is
// not a preference — without it the deploy fails listing this file.
export const runtime = "edge"

import Link from "next/link"
import { requireUser } from "@/lib/require-user"
import { keyBadge } from "@/lib/key-display"
import { IssueKeyButton, RevokeKeyButton } from "@/components/KeyRow"

const TONE: Record<string, string> = {
  live: "bg-tertiary_container text-green-900",
  test: "bg-amber-100 text-on_warning_container",
  revoked: "bg-secondary_container text-on_secondary_container",
}

export default async function KeysPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  const { data: keys } = await supabase
    .from("app_key")
    .select(
      "id, key, label, environment, platform, bundle_id, cert_digests, attestation_policy, revoked_at, created_at",
    )
    .eq("app_id", params.id)
    .order("created_at", { ascending: false })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href={`/apps/${params.id}`} className="text-sm text-secondary hover:underline">
        ← app
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Keys</h1>
        <IssueKeyButton appId={params.id} />
      </div>

      <p className="mt-2 max-w-2xl text-sm text-secondary">
        These are <strong>publishable</strong> keys — they ship inside your app and are safe to
        display here. What protects them is the package and certificate binding below, not
        secrecy. Issuing creates a live key and a test key together; the test key skips
        attestation, because Play Integrity rejects debug and sideloaded builds.
      </p>

      {!keys?.length ? (
        <p className="mt-6 rounded border border-dashed p-8 text-center text-sm text-secondary">
          No keys yet.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-secondary">
              <tr>
                <th className="py-2">Key</th>
                <th>Env</th>
                <th>Platform</th>
                <th>Bundle</th>
                <th>Attestation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const badge = keyBadge(k)
                return (
                  <tr key={k.id} className="border-t">
                    <td className={`py-2 font-mono text-xs ${k.revoked_at ? "text-secondary line-through" : ""}`}>
                      {k.key}
                    </td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs ${TONE[badge.tone]}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="text-on_surface_variant">{k.platform ?? "any"}</td>
                    <td className="font-mono text-xs text-on_surface_variant">{k.bundle_id ?? "—"}</td>
                    <td className="text-on_surface_variant">{k.attestation_policy}</td>
                    <td className="text-right">
                      {!k.revoked_at && <RevokeKeyButton keyId={k.id} appId={params.id} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
