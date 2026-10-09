/**
 * The per-app sections, as one table.
 *
 * `section` is the URL segment; `label` is the sidebar entry. The switcher needs the first to
 * build a sibling app's URL, the sidebar needs the second to highlight a row. Deriving both from
 * one table is what keeps a renamed route from silently un-highlighting its own nav row — and
 * `history`/`Activity` is the live proof the two are not interchangeable.
 */
export const SECTIONS = [
  { section: "parameters", label: "Parameters" },
  { section: "conditions", label: "Conditions" },
  { section: "configs", label: "Configs" },
  { section: "templates", label: "Templates" },
  { section: "keys", label: "Keys" },
  { section: "preview", label: "Preview" },
  { section: "history", label: "Activity" },
  { section: "publish", label: "Publish" },
] as const

export type Section = (typeof SECTIONS)[number]

/**
 * Which section a pathname is in, or null at the app root / on an unknown path.
 *
 * Matches on `/{segment}` so a nested authoring route (`…/configs/new`) still resolves to its
 * parent — the sidebar should highlight Configs while you are creating one.
 */
export function resolveSection(pathname: string): Section | null {
  return SECTIONS.find((s) => pathname.includes(`/${s.section}`)) ?? null
}

/**
 * Where the switcher sends you for another app: the same section you are on now.
 *
 * With no section — the app root, or a path that resolved to nothing — this returns the other
 * app's root. The alternative is interpolating an empty or undefined segment and handing the
 * operator a 404 behind a menu item that looked fine.
 */
export function switchHref(appId: string, section: string | null | undefined): string {
  return section ? `/apps/${appId}/${section}` : `/apps/${appId}`
}
