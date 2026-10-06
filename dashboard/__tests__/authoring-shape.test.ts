import { authoringShape } from "@/lib/authoring-shape"

/**
 * AC12: for feature_flag the authoring screen shows no display, no preview, and no
 * impression controls. The shape is a pure function so the conditional can be asserted
 * without rendering — this is the conditional a later refactor is most likely to invert.
 */
describe("authoringShape", () => {
  it("a UI template gets content, preview, display picker and impression controls", () => {
    expect(authoringShape({ id: "update_available", renders_ui: true, allowed_displays: ["dialog", "bottom_sheet"] }))
      .toEqual({ showContent: true, showPreview: true, showDisplayPicker: true, showImpressionControls: true })
  })

  it("feature_flag collapses to content + targeting only", () => {
    expect(authoringShape({ id: "feature_flag", renders_ui: false, allowed_displays: ["none"] }))
      .toEqual({ showContent: true, showPreview: false, showDisplayPicker: false, showImpressionControls: false })
  })

  it("keys off renders_ui, not the id — a future value-only template collapses too", () => {
    // Keying on "feature_flag" would render a preview panel for this one, and the preview
    // has nothing to draw because allowed_displays is {none}.
    const s = authoringShape({ id: "remote_kill_switch", renders_ui: false, allowed_displays: ["none"] })
    expect(s.showPreview).toBe(false)
    expect(s.showDisplayPicker).toBe(false)
  })

  it("a single allowed display still hides the picker — there is nothing to pick", () => {
    const s = authoringShape({ id: "geo_notice", renders_ui: true, allowed_displays: ["banner"] })
    expect(s.showPreview).toBe(true)
    expect(s.showDisplayPicker).toBe(false)
  })
})
