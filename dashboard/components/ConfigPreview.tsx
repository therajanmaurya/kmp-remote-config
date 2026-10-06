"use client"

import type { Field } from "@/lib/schema-form"

type Props = { display: string; payload: Record<string, unknown>; fields?: Field[] }

/**
 * Pick which payload values act as the headline, the body and the CTA.
 *
 * Reading `payload.title` / `payload.body` directly was wrong for most of the 15 builtins:
 * update_available has store_url / forced / release_notes / current_version and NO title,
 * so the preview rendered two grey placeholders and showed the operator nothing. The
 * fields carry the shape, so they decide.
 */
function pick(payload: Record<string, unknown>, fields: Field[]) {
  const str = (n?: string) => (n && typeof payload[n] === "string" ? (payload[n] as string) : null)
  const byName = (re: RegExp) => fields.find((f) => re.test(f.name))?.name
  const byControl = (c: string) => fields.find((f) => f.control === c)?.name

  const title =
    str(byName(/^(title|headline|heading|name)$/)) ??
    str(byName(/version|key/)) ??
    str(byControl("text"))
  const body =
    str(byName(/^(body|message|notes|description|release_notes)$/)) ??
    str(byControl("textarea")) ??
    // Do not reuse whatever became the title as the body too.
    str(fields.filter((f) => f.control === "text")[1]?.name)
  const cta = str(byName(/label|cta/))

  return { title, body, cta }
}

/**
 * A representation, not the SDK renderer.
 *
 * The SDK's Compose implementation is the real thing; this exists so the operator can tell
 * a dialog from a banner and see their copy at roughly the right length. It deliberately
 * imports nothing from the SDK — the SDK is Kotlin, and a second TypeScript "renderer"
 * claiming fidelity would be a lie no contract test can check. Labelled as an
 * approximation in the UI for exactly that reason.
 */
export function ConfigPreview({ display, payload, fields = [] }: Props) {
  const picked = pick(payload, fields)
  const title = picked.title || null
  const body = picked.body || null
  const cta = picked.cta || null

  const Placeholder = ({ children }: { children: string }) => (
    <span className="text-neutral-400">{children}</span>
  )

  const content = (
    <>
      <p className="font-medium">{title ?? <Placeholder>Title</Placeholder>}</p>
      <p className="mt-1 text-sm text-neutral-600">{body ?? <Placeholder>Body text</Placeholder>}</p>
      {cta && (
        <button className="mt-3 w-full rounded bg-neutral-900 py-2 text-sm text-white">{cta}</button>
      )}
    </>
  )

  return (
    <div data-testid="config-preview" className="rounded-[2rem] border-4 border-neutral-800 bg-neutral-50 p-3">
      <div className="relative h-[420px] overflow-hidden rounded-[1.5rem] bg-white">
        {display === "dialog" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full rounded-lg bg-white p-4 shadow-lg">{content}</div>
          </div>
        )}
        {display === "bottom_sheet" && (
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]">
            <div className="mx-auto mb-3 h-1 w-10 rounded bg-neutral-300" />
            {content}
          </div>
        )}
        {display === "banner" && (
          <div className="absolute inset-x-0 top-0 border-b bg-amber-50 p-3">{content}</div>
        )}
        {/* `fullscreen`, not `full_screen` — the token the seeded templates and the SDK's
            DisplayType actually use. The underscored spelling matched nothing. */}
        {display === "fullscreen" && <div className="absolute inset-0 bg-white p-5">{content}</div>}
        {display === "inline" && (
          <div className="absolute inset-x-0 top-24 mx-3 rounded border bg-white p-3">{content}</div>
        )}
        {!["dialog", "bottom_sheet", "banner", "fullscreen", "inline"].includes(display) && (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-500">
            No preview for display “{display}”.
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-neutral-500">
        Approximate — your app&apos;s theme decides the final appearance.
      </p>
    </div>
  )
}
