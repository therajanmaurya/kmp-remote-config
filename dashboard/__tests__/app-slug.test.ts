import { slugify } from "@/lib/slug"

/**
 * app_slug_shape CHECK is ^[a-z0-9][a-z0-9-]*[a-z0-9]$ (migration 002). Every case below
 * produced a violation when the display name was passed through unchanged, and a
 * constraint violation reaches the operator as an opaque failure they cannot act on.
 */
describe("slugify", () => {
  it.each([
    ["My App", "my-app"],
    ["My App!", "my-app"],
    ["  spaced  out  ", "spaced-out"],
    ["-leading-and-trailing-", "leading-and-trailing"],
    ["Café Münster", "cafe-munster"],
    ["under_scores", "under-scores"],
    ["multiple---dashes", "multiple-dashes"],
    ["UPPER", "upper"],
    ["trailing dash -", "trailing-dash"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it("returns empty when nothing usable remains, so the caller can reject it", () => {
    // Must NOT invent a slug: one the operator never typed silently becomes part of their
    // key prefixes and every log line for that app.
    expect(slugify("!!!")).toBe("")
    expect(slugify("")).toBe("")
    expect(slugify("---")).toBe("")
  })

  it("every non-empty result satisfies the database CHECK", () => {
    const CHECK = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
    for (const name of ["A", "My App", "Café", "x9", "a-b-c", "99 bottles"]) {
      const s = slugify(name)
      expect(s).not.toBe("")
      expect(CHECK.test(s)).toBe(true)
    }
  })
})
