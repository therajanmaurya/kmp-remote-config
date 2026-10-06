"use client"

import type { Field } from "@/lib/schema-form"

type Props = {
  fields: Field[]
  values: Record<string, unknown>
  errors: Record<string, string>
  onChange: (name: string, value: unknown) => void
}

/**
 * Renders Field[] — presentation only. All validation lives in schema-form.ts#validate, so
 * there is exactly one place that decides whether a payload may be submitted.
 */
export function SchemaForm({ fields, values, errors, onChange }: Props) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const err = errors[f.name]
        const id = `field-${f.name}`
        const common = "mt-1 w-full rounded border px-3 py-2 text-sm"
        const v = values[f.name]

        return (
          <div key={f.name}>
            <label htmlFor={id} className="block text-sm font-medium">
              {f.label}
              {f.required && <span className="ml-1 text-red-600">*</span>}
            </label>

            {f.control === "text" && (
              <input id={id} className={common} value={(v as string) ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)} />
            )}

            {f.control === "textarea" && (
              <textarea id={id} rows={4} className={common} value={(v as string) ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)} />
            )}

            {f.control === "url" && (
              <input id={id} type="url" inputMode="url" placeholder="https://" className={common}
                value={(v as string) ?? ""} onChange={(e) => onChange(f.name, e.target.value)} />
            )}

            {f.control === "switch" && (
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input id={id} type="checkbox" checked={Boolean(v)}
                  onChange={(e) => onChange(f.name, e.target.checked)} />
                <span className="text-neutral-600">{f.label}</span>
              </label>
            )}

            {f.control === "select" && (
              <select id={id} className={common} value={(v as string) ?? ""}
                onChange={(e) => onChange(f.name, e.target.value)}>
                <option value="">Choose…</option>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}

            {f.control === "json" && (
              <>
                <input id={id} className={`${common} font-mono`} value={(v as string) ?? ""}
                  placeholder='"beta"  ·  42  ·  true'
                  onChange={(e) => onChange(f.name, e.target.value)} />
                <p className="mt-1 text-xs text-neutral-500">
                  Any JSON value. Quote strings: <code>&quot;beta&quot;</code>.
                </p>
              </>
            )}

            {f.control === "repeat" && (
              <RepeatField id={id} value={(v as string[]) ?? []}
                onChange={(next) => onChange(f.name, next)} />
            )}

            {f.control === "unsupported" && (
              // Visible and submit-blocking rather than silently dropped. A dropped field
              // saves a config the server accepts only if that field happened to be
              // optional — and when it was required, the error names a field the operator
              // never saw.
              <p data-testid={`unsupported-${f.name}`}
                className="mt-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                This template uses a <code>{f.rawType}</code> field, which this editor cannot
                show yet. Saving is blocked so nothing silently loses this value.
              </p>
            )}

            {f.maxLength !== undefined && typeof v === "string" && (
              <p className="mt-1 text-right text-xs text-neutral-400">
                {v.length}/{f.maxLength}
              </p>
            )}
            {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
          </div>
        )
      })}
    </div>
  )
}

function RepeatField({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="mt-1 space-y-2">
      {value.map((row, i) => (
        <div key={i} className="flex gap-2">
          <input
            id={i === 0 ? id : undefined}
            className="w-full rounded border px-3 py-2 text-sm"
            value={row}
            onChange={(e) => onChange(value.map((r, j) => (j === i ? e.target.value : r)))}
          />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="rounded border px-2 text-sm text-neutral-600">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, ""])}
        className="rounded border px-2 py-1 text-xs text-neutral-700">
        Add entry
      </button>
    </div>
  )
}
