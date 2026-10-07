export type Predicate = {
  platforms?: string[]
  screens?: string[]
  min_app_version?: string | null
  max_app_version?: string | null
}

/**
 * A condition's predicate in plain language.
 *
 * Operators reason about "Android beta users", not about a JSON object. Showing the raw
 * predicate in the list would make every condition look alike at a glance, which is the one
 * thing a reusable-condition list must avoid — the whole point is recognising which one you
 * are attaching.
 */
export function describePredicate(p: Predicate | null | undefined): string {
  if (!p) return "matches everyone"
  const parts: string[] = []
  if (p.platforms?.length) parts.push(`platform is ${p.platforms.join(" or ")}`)
  if (p.screens?.length) parts.push(`screen is ${p.screens.join(" or ")}`)
  if (p.min_app_version) parts.push(`app ≥ ${p.min_app_version}`)
  if (p.max_app_version) parts.push(`app ≤ ${p.max_app_version}`)
  // An empty predicate matches everyone — stated explicitly, because a blank cell would read
  // as "not configured yet" when it actually means "applies to every device".
  return parts.length ? parts.join(" and ") : "matches everyone"
}
