export type TemplateShapeInput = {
  id: string
  renders_ui: boolean
  allowed_displays: string[]
}

/**
 * Which sections the authoring screen shows for a template.
 *
 * Driven by `renders_ui`, NEVER by the template id: the seeded feature_flag row is
 * `renders_ui = false, allowed_displays = {none}`, and §9 leaves room for further
 * value-only templates. An id check would render a preview panel with nothing to draw for
 * every one of them.
 *
 * The display picker also hides when there is only one real choice — offering a select
 * with a single option asks the operator to make a decision that does not exist.
 */
export function authoringShape(template: TemplateShapeInput) {
  const rendersUi = template.renders_ui
  const realDisplays = template.allowed_displays.filter((d) => d !== "none")

  return {
    showContent: true,
    showPreview: rendersUi,
    showDisplayPicker: rendersUi && realDisplays.length > 1,
    showImpressionControls: rendersUi,
  }
}
