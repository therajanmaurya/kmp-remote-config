import { buildSchema } from "@/lib/schema-builder"
import { fieldsFor } from "@/lib/schema-form"

/**
 * buildSchema is the inverse of fieldsFor, so the round trip is the real assertion: a
 * schema the builder emits must read back as the same field list. Without this the two
 * drift silently — the operator composes a textarea and the authoring form renders a
 * single-line input, which looks like a rendering bug and is actually a schema bug.
 */
describe("buildSchema ∘ fieldsFor round trip", () => {
  it("survives every control the authoring form supports", () => {
    const built = buildSchema([
      { name: "title", label: "Title", control: "text", required: true },
      { name: "body", label: "Body", control: "textarea", required: true },
      { name: "store_url", label: "Store url", control: "url", required: false },
      { name: "force", label: "Force", control: "switch", required: false },
      { name: "channel", label: "Channel", control: "select", required: false, options: ["stable", "beta"] },
      { name: "regions", label: "Regions", control: "repeat", required: true, minItems: 1 },
    ])

    const back = Object.fromEntries(fieldsFor(built as never).map((f) => [f.name, f]))
    expect(back.title.control).toBe("text")
    expect(back.body.control).toBe("textarea")
    expect(back.store_url.control).toBe("url")
    expect(back.force.control).toBe("switch")
    expect(back.channel.control).toBe("select")
    expect(back.channel.options).toEqual(["stable", "beta"])
    expect(back.regions.control).toBe("repeat")
    expect(back.regions.minItems).toBe(1)
  })

  it("required-ness survives the round trip", () => {
    const built = buildSchema([
      { name: "a", label: "A", control: "text", required: true },
      { name: "b", label: "B", control: "text", required: false },
    ])
    const back = Object.fromEntries(fieldsFor(built as never).map((f) => [f.name, f]))
    expect(back.a.required).toBe(true)
    expect(back.b.required).toBe(false)
  })

  it("never emits a field the authoring form would call unsupported", () => {
    // A builder that can compose something its own renderer cannot show is a trap: the
    // operator saves a template and then cannot author a config with it.
    const built = buildSchema([
      { name: "x", label: "X", control: "text", required: false },
      { name: "y", label: "Y", control: "repeat", required: false },
    ])
    expect(fieldsFor(built as never).every((f) => f.control !== "unsupported")).toBe(true)
  })

  it("rejects a field name that is not a valid property key", () => {
    expect(() => buildSchema([{ name: "has space", label: "X", control: "text", required: false }]))
      .toThrow(/field name/i)
  })

  it("rejects duplicate field names rather than silently dropping one", () => {
    // Object.fromEntries would keep the last — the operator loses a field with no message.
    expect(() => buildSchema([
      { name: "dup", label: "A", control: "text", required: false },
      { name: "dup", label: "B", control: "text", required: false },
    ])).toThrow(/duplicate/i)
  })

  it("rejects a choice field with no options", () => {
    expect(() => buildSchema([{ name: "c", label: "C", control: "select", required: false }]))
      .toThrow(/options/i)
  })
})
