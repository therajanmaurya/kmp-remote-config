import { TEXTAREA_MIN_MAXLENGTH, type Control, type JsonSchema } from "@/lib/schema-form"

export type BuilderField = {
  name: string
  label: string
  control: Control
  required: boolean
  options?: string[]
  minItems?: number
}

/** Chosen so fieldsFor reads it back as a textarea; see TEXTAREA_MIN_MAXLENGTH. */
const TEXTAREA_MAXLENGTH = 500

/**
 * The inverse of fieldsFor.
 *
 * The emitted schema must read back as the same field list — __tests__/schema-builder
 * asserts the round trip, because drift between the two reaches the operator as a
 * rendering bug when it is really a schema bug.
 *
 * A textarea is expressed as a maxLength rather than a flag: JSON Schema has no notion of
 * "render this big", and fieldsFor's rule is maxLength > TEXTAREA_MIN_MAXLENGTH. The
 * threshold is imported rather than duplicated so the pair cannot drift.
 */
export function buildSchema(fields: BuilderField[]): JsonSchema {
  const seen = new Set<string>()
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const f of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(f.name)) {
      throw new Error(
        `Invalid field name "${f.name}" — use lowercase letters, digits and underscores, starting with a letter.`,
      )
    }
    if (seen.has(f.name)) throw new Error(`Duplicate field name "${f.name}".`)
    seen.add(f.name)

    switch (f.control) {
      case "text":
        properties[f.name] = { type: "string" }
        break
      case "textarea":
        properties[f.name] = { type: "string", maxLength: TEXTAREA_MAXLENGTH }
        break
      case "url":
        properties[f.name] = { type: "string", format: "uri" }
        break
      case "switch":
        properties[f.name] = { type: "boolean" }
        break
      case "select":
        if (!f.options?.length) throw new Error(`Field "${f.name}" is a choice with no options.`)
        properties[f.name] = { type: "string", enum: f.options }
        break
      case "repeat":
        properties[f.name] = {
          type: "array",
          items: { type: "string" },
          ...(f.minItems !== undefined ? { minItems: f.minItems } : {}),
        }
        break
      default:
        // The builder must never compose something its own renderer cannot show.
        throw new Error(`Control "${f.control}" cannot be built.`)
    }

    if (f.required) required.push(f.name)
  }

  if (TEXTAREA_MAXLENGTH <= TEXTAREA_MIN_MAXLENGTH) {
    throw new Error("textarea maxLength must exceed the schema-form threshold")
  }

  return { type: "object", required, properties }
}
