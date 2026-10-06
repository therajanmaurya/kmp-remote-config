import { defaultsFor, fieldsFor, validate } from "@/lib/schema-form"

const updateAvailable = {
  type: "object",
  required: ["title", "body", "version_name"],
  properties: {
    title: { type: "string" },
    body: { type: "string", maxLength: 500 },
    version_name: { type: "string" },
    store_url: { type: "string", format: "uri" },
    force: { type: "boolean" },
    channel: { type: "string", enum: ["stable", "beta"] },
  },
} as const

describe("fieldsFor", () => {
  it("maps each documented type to its control", () => {
    const byName = Object.fromEntries(fieldsFor(updateAvailable as never).map((f) => [f.name, f]))
    expect(byName.title.control).toBe("text")
    expect(byName.body.control).toBe("textarea") // maxLength 500 > 120
    expect(byName.store_url.control).toBe("url")
    expect(byName.force.control).toBe("switch")
    expect(byName.channel.control).toBe("select")
    expect(byName.channel.options).toEqual(["stable", "beta"])
  })

  it("marks required fields from the schema's required array, not per-property", () => {
    const byName = Object.fromEntries(fieldsFor(updateAvailable as never).map((f) => [f.name, f]))
    expect(byName.title.required).toBe(true)
    expect(byName.store_url.required).toBe(false)
  })

  it("maps an array of strings to repeatable rows", () => {
    const schema = {
      type: "object", required: ["regions"],
      properties: { regions: { type: "array", items: { type: "string" }, minItems: 1 } },
    }
    const [f] = fieldsFor(schema as never)
    expect(f.control).toBe("repeat")
    expect(f.minItems).toBe(1)
  })

  // REVIEW FOCUS #2 — the 16th template is what this generator will actually meet.
  it("renders an unhandled type as a labelled fallback and NEVER drops it", () => {
    const schema = {
      type: "object", required: ["budget"],
      properties: { budget: { type: "number", minimum: 0 } },
    }
    const fields = fieldsFor(schema as never)
    expect(fields).toHaveLength(1) // present, not dropped
    expect(fields[0].control).toBe("unsupported")
    expect(fields[0].name).toBe("budget")
    expect(fields[0].rawType).toBe("number")
  })

  it("an unsupported field blocks submit with an actionable message", () => {
    const fields = fieldsFor({
      type: "object", required: ["budget"], properties: { budget: { type: "number" } },
    } as never)
    // Blocking is the point: silently saving produces a config the server accepts only by
    // luck, and the operator never learns the field was not editable here.
    expect(validate(fields, { budget: 5 }).budget).toMatch(/not support/i)
  })
})

describe("validate", () => {
  const fields = fieldsFor(updateAvailable as never)

  it("requires the schema's required fields", () => {
    expect(validate(fields, {})).toMatchObject({
      title: expect.stringMatching(/required/i),
      body: expect.stringMatching(/required/i),
      version_name: expect.stringMatching(/required/i),
    })
  })

  it("accepts a complete payload", () => {
    expect(validate(fields, {
      title: "Update available",
      body: "A new version is ready.",
      version_name: "4.1.0",
      store_url: "https://play.google.com/store/apps/details?id=x",
    })).toEqual({})
  })

  it("rejects a url that is not one, on that field", () => {
    expect(validate(fields, {
      title: "t", body: "b", version_name: "1", store_url: "play.google.com/x",
    }).store_url).toMatch(/valid url/i)
  })

  it("enforces maxLength rather than letting the database reject it", () => {
    expect(validate(fields, {
      title: "t", body: "x".repeat(501), version_name: "1",
    }).body).toMatch(/500/)
  })

  it("enforces minItems on a repeatable", () => {
    const f = fieldsFor({
      type: "object", required: ["regions"],
      properties: { regions: { type: "array", items: { type: "string" }, minItems: 1 } },
    } as never)
    expect(validate(f, { regions: [] }).regions).toMatch(/at least 1/i)
  })

  it("a false switch is not 'missing' — false is a real answer", () => {
    // Treating false as empty would make every unchecked required boolean unsubmittable.
    const f = fieldsFor({
      type: "object", required: ["force"], properties: { force: { type: "boolean" } },
    } as never)
    expect(validate(f, { force: false })).toEqual({})
  })
})

/**
 * Both cases below are REAL seeded builtins, not hypotheticals. They were found by the
 * authoring e2e failing against the live template rows.
 */
describe("the shipped builtins that broke the first generator", () => {
  // feature_flag's `value` is deliberately `{}` — a flag value may be a string, a boolean
  // or a number, so the schema declines to pin one. Treating typeless as "unsupported"
  // made feature_flag — one of the 15 — impossible to author.
  const featureFlag = {
    type: "object",
    required: ["key", "value"],
    properties: { key: { type: "string" }, value: {} },
  } as const

  it("a typeless property is an editable JSON value, not unsupported", () => {
    const byName = Object.fromEntries(fieldsFor(featureFlag as never).map((f) => [f.name, f]))
    expect(byName.key.control).toBe("text")
    expect(byName.value.control).toBe("json")
  })

  it("a json field accepts any JSON scalar, and rejects unparseable input", () => {
    const fields = fieldsFor(featureFlag as never)
    expect(validate(fields, { key: "k", value: "true" })).toEqual({})
    expect(validate(fields, { key: "k", value: "42" })).toEqual({})
    expect(validate(fields, { key: "k", value: '"beta"' })).toEqual({})
    expect(validate(fields, { key: "k", value: "{oops" }).value).toMatch(/valid json/i)
  })

  // update_available.forced is `{"type":"boolean","default":false}`. Ignoring the default
  // left the payload without the key while the checkbox rendered unchecked — what the
  // operator saw and what would be saved disagreed, and the save failed "Forced is
  // required."
  it("surfaces a schema default so the form can seed it", () => {
    const fields = fieldsFor({
      type: "object",
      required: ["forced"],
      properties: { forced: { type: "boolean", default: false } },
    } as never)
    expect(fields[0].defaultValue).toBe(false)
  })

  it("defaultsFor seeds every declared default, and nothing else", () => {
    const fields = fieldsFor({
      type: "object",
      required: ["forced"],
      properties: {
        forced: { type: "boolean", default: false },
        channel: { type: "string", enum: ["a", "b"], default: "a" },
        title: { type: "string" },
      },
    } as never)
    expect(defaultsFor(fields)).toEqual({ forced: false, channel: "a" })
  })
})
