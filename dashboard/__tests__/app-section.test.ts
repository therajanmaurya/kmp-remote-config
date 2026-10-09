import { SECTIONS, resolveSection, switchHref } from "@/lib/app-section"

/**
 * The switcher builds a sibling app's URL from the section the operator is currently on, so a
 * wrong resolution does not mis-highlight a row — it navigates somewhere that does not exist.
 *
 * The sharp case is an UNRESOLVED path. `/apps/{id}/parameters` resolving to nothing would make
 * the href `/apps/{other}/undefined`, a 404 reached by clicking a working-looking menu item.
 */
describe("resolveSection", () => {
  it("resolves every section the sidebar links to", () => {
    // Guards the drift this table exists to prevent: a sidebar row whose URL segment no
    // longer resolves back to its own label.
    for (const s of SECTIONS) {
      expect(resolveSection(`/apps/abc-123/${s.section}`)).toEqual(s)
    }
  })

  it("resolves a nested route to its parent section", () => {
    // Authoring pages live under the section (…/configs/new); the sidebar still highlights Configs.
    expect(resolveSection("/apps/abc-123/configs/new")?.label).toBe("Configs")
  })

  it("maps history to the Activity label", () => {
    // The one place segment and label deliberately differ.
    expect(resolveSection("/apps/abc-123/history")?.label).toBe("Activity")
  })

  it("returns null for the app root and for an unknown path", () => {
    expect(resolveSection("/apps/abc-123")).toBeNull()
    expect(resolveSection("")).toBeNull()
  })
})

describe("switchHref", () => {
  it("keeps the operator on the same section in the other app", () => {
    expect(switchHref("target-id", "conditions")).toBe("/apps/target-id/conditions")
  })

  it("falls back to the app root rather than producing a dead segment", () => {
    // Never `/apps/target-id/undefined` or a trailing slash.
    expect(switchHref("target-id", null)).toBe("/apps/target-id")
    expect(switchHref("target-id", "")).toBe("/apps/target-id")
  })
})
