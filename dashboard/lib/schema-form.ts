/** The subset of JSON Schema the 15 builtin templates actually use. */
export type JsonSchema = {
  type: "object"
  required?: string[]
  properties: Record<string, Record<string, unknown>>
}

export type Control =
  | "text"
  | "textarea"
  | "url"
  | "switch"
  | "select"
  | "repeat"
  /** A typeless property — any JSON scalar. feature_flag's `value` is exactly this. */
  | "json"
  | "unsupported"

export type Field = {
  name: string
  label: string
  control: Control
  required: boolean
  maxLength?: number
  options?: string[]
  minItems?: number
  /** The raw JSON Schema type, kept so an unsupported field can name it to the operator. */
  rawType?: string
  /** The schema's own `default`, if it declares one. */
  defaultValue?: unknown
}

/** The threshold between a single line and a paragraph (§11.3). */
export const TEXTAREA_MIN_MAXLENGTH = 120

/** `version_name` → `Version name`. */
function humanize(name: string): string {
  const s = name.replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Derive the form from `template.payload_schema`.
 *
 * An unrecognised type yields control "unsupported" rather than being skipped. Skipping is
 * the dangerous behaviour: the field vanishes from the form, the operator saves, and the
 * payload passes the server's jsonb_matches_schema only if that field happened to be
 * optional. When it was required, the save fails with a schema error naming a field the
 * form never showed.
 */
export function fieldsFor(schema: JsonSchema): Field[] {
  const required = new Set(schema.required ?? [])

  return Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const base = {
      name,
      label: humanize(name),
      required: required.has(name),
      ...("default" in prop ? { defaultValue: prop.default } : {}),
    }
    const type = prop.type as string | undefined

    // A property with NO declared type is not an error and not unsupported — it means
    // "any JSON value". feature_flag's `value` is deliberately `{}` because a flag may hold
    // a string, a boolean or a number, and marking it unsupported made one of the fifteen
    // shipped builtins impossible to author.
    if (type === undefined && !Array.isArray(prop.enum)) {
      return { ...base, control: "json" as Control }
    }

    if (type === "string") {
      if (Array.isArray(prop.enum)) {
        return { ...base, control: "select" as Control, options: prop.enum as string[] }
      }
      if (prop.format === "uri") return { ...base, control: "url" as Control }
      const maxLength = typeof prop.maxLength === "number" ? prop.maxLength : undefined
      return {
        ...base,
        control: (maxLength !== undefined && maxLength > TEXTAREA_MIN_MAXLENGTH
          ? "textarea"
          : "text") as Control,
        maxLength,
      }
    }

    if (type === "boolean") return { ...base, control: "switch" as Control }

    if (type === "array" && (prop.items as Record<string, unknown>)?.type === "string") {
      return {
        ...base,
        control: "repeat" as Control,
        minItems: typeof prop.minItems === "number" ? prop.minItems : undefined,
      }
    }

    return { ...base, control: "unsupported" as Control, rawType: type ?? "unknown" }
  })
}

/** Field name → message. An empty object means the form may be submitted. */
export function validate(fields: Field[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const f of fields) {
    const v = values[f.name]

    if (f.control === "unsupported") {
      // Blocks submit deliberately — see fieldsFor's comment.
      errors[f.name] =
        `This template uses a "${f.rawType}" field, which this editor does not support yet. ` +
        `Author it through the API, or ask for support to be added.`
      continue
    }

    // A repeatable with a minItems floor reports the FLOOR, not "required": an empty list
    // and a one-short list are the same mistake, and "needs at least 2 entries" tells the
    // operator what to do where "Regions is required" reads as "you skipped the form"
    // about a field sitting right in front of them.
    if (f.control === "repeat" && f.minItems !== undefined) {
      const items = Array.isArray(v) ? v : []
      if (items.length < f.minItems) {
        errors[f.name] =
          `${f.label} needs at least ${f.minItems} entr${f.minItems === 1 ? "y" : "ies"}.`
      }
      continue
    }

    // A false switch is a real answer, not a missing one. Treating it as empty would make
    // every unchecked required boolean unsubmittable.
    const empty =
      f.control === "switch"
        ? v === undefined || v === null
        : v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)

    if (f.required && empty) {
      errors[f.name] = `${f.label} is required.`
      continue
    }
    if (empty) continue

    if (f.control === "json" && typeof v === "string") {
      try {
        JSON.parse(v)
      } catch {
        errors[f.name] =
          `${f.label} must be valid JSON — a quoted string ("beta"), a number (42), true, or false.`
      }
    }

    if (f.control === "url" && typeof v === "string") {
      try {
        const u = new URL(v)
        if (!u.protocol.startsWith("http")) throw new Error("scheme")
      } catch {
        errors[f.name] = `${f.label} must be a valid URL, including https://`
      }
    }

    if (f.maxLength !== undefined && typeof v === "string" && v.length > f.maxLength) {
      errors[f.name] =
        `${f.label} must be ${f.maxLength} characters or fewer (currently ${v.length}).`
    }
  }

  return errors
}

/**
 * The initial payload for a freshly-chosen template: every field whose schema declares a
 * `default`, and nothing else.
 *
 * Without this, update_available's `forced` (`{"type":"boolean","default":false}`) rendered
 * as an unchecked box while the payload had no `forced` key at all — so what the operator
 * saw and what would be saved disagreed, and the save failed "Forced is required." Seeding
 * declared defaults makes the two the same thing and honours what the schema author meant.
 */
export function defaultsFor(fields: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.defaultValue !== undefined) out[f.name] = f.defaultValue
  }
  return out
}
