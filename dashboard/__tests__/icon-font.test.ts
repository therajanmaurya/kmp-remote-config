import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The dashboard downloaded a **4,003,092-byte font** on every first visit.
 *
 * Google serves the complete Material Symbols variable font — every icon it has — unless the
 * stylesheet URL carries `icon_names`. Subset to the fourteen this app renders, the same font
 * is 19,176 bytes. Nothing failed, nothing warned; the only symptom was that the site felt slow,
 * which is exactly the kind of regression that survives for months.
 *
 * Two assertions, because each catches a different way of reintroducing it:
 *  - the URL must still be subsetted at all;
 *  - every icon the source renders must be IN the subset, or it silently renders as its
 *    ligature text and the obvious "fix" is to delete the parameter.
 */

const LAYOUT = join(__dirname, "..", "app", "layout.tsx")

function sourceFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sourceFiles(p, acc)
    else if (p.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

const layout = readFileSync(LAYOUT, "utf8")

test("the Material Symbols stylesheet is subsetted", () => {
  expect(layout).toContain("Material+Symbols+Outlined")
  // Without this the response is the full 4MB font.
  expect(layout).toContain("icon_names=")
})

test("every icon rendered in the app is present in the subset", () => {
  const declared = new Set(
    (layout.match(/const ICON_NAMES = \[([\s\S]*?)\]/)?.[1] ?? "")
      .match(/"([a-z_]+)"/g)
      ?.map((s) => s.replace(/"/g, "")) ?? [],
  )
  expect(declared.size).toBeGreaterThan(0)

  const used = new Set<string>()
  for (const f of [...sourceFiles(join(__dirname, "..", "app")), ...sourceFiles(join(__dirname, "..", "components"))]) {
    const src = readFileSync(f, "utf8")
    // <span className="material-symbols-outlined …">icon_name</span>
    for (const m of src.matchAll(/material-symbols-outlined[^>]*>\s*\{?\s*"?([a-z_]{3,})"?\s*\}?\s*</g)) used.add(m[1])
    // nav data: { icon: "rocket_launch", … }
    for (const m of src.matchAll(/\bicon:\s*"([a-z_]+)"/g)) used.add(m[1])
    // A TERNARY inside the span — {done ? "check" : "content_copy"}. The two extractors above
    // miss this shape entirely, and three icons added that way shipped as literal ligature
    // text before this line existed. Every quoted token inside a material-symbols span counts.
    for (const m of src.matchAll(/material-symbols-outlined[^>]*>\s*\{[^}]*\}/g)) {
      for (const q of m[0].matchAll(/"([a-z_]{3,})"/g)) used.add(q[1])
    }
  }
  // `name` is the Icon component's own prop, not a glyph.
  used.delete("name")

  const missing = [...used].filter((i) => !declared.has(i)).sort()
  expect(missing).toEqual([])
})

test("no icon is declared that nothing renders", () => {
  // A stale name costs bytes in the subset and hides the fact that a surface was removed.
  const declared = (layout.match(/const ICON_NAMES = \[([\s\S]*?)\]/)?.[1] ?? "")
    .match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? []

  const haystack = [...sourceFiles(join(__dirname, "..", "app")), ...sourceFiles(join(__dirname, "..", "components"))]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")

  const unused = declared.filter((i) => !new RegExp(`["'>]${i}["'<]`).test(haystack))
  expect(unused).toEqual([])
})
