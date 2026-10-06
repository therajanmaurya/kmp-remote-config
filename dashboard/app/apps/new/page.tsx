"use client"

import { useState } from "react"
import { createApp } from "../actions"
import { slugify } from "@/lib/slug"

const PLATFORMS = ["android", "ios", "desktop", "web", "wasm"] as const

export default function NewAppPage() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")

  const slug = slugify(name)

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">New app</h1>
      <form
        className="mt-6 space-y-5"
        action={async (fd) => {
          setBusy(true)
          setError(null)
          const res = await createApp(fd)
          // createApp redirects on success, so reaching here with a value means failure.
          if (res?.error) {
            setError(res.error)
            setBusy(false)
          }
        }}
      >
        <div>
          <label htmlFor="display_name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="display_name"
            name="display_name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="Acme Reader"
          />
          {/* Show the derived slug as it is typed: it ends up in key prefixes and logs, so
              the operator should see it BEFORE saving rather than discover it after. */}
          <p className="mt-1 text-xs text-neutral-500">
            {slug ? (
              <>
                Slug: <span className="font-mono">{slug}</span> — appears in your key prefixes.
              </>
            ) : (
              "The slug is derived from this name and appears in your key prefixes."
            )}
          </p>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Platforms</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {PLATFORMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="platforms" value={p} /> {p}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          disabled={busy}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create app"}
        </button>
      </form>
    </main>
  )
}
