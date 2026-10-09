import { fleetTotals } from "@/lib/fleet"
import type { AppRow } from "@/lib/fleet"

const app = (over: Partial<AppRow> = {}): AppRow => ({
  id: "a", slug: "a", display_name: "A", platforms: ["android"],
  parameters: 0, conditions: 0, configs: 0, keys: 0, liveVersion: null, unpublished: 0,
  ...over,
})

/**
 * The org dashboard used to REDIRECT a zero-app account straight to /onboarding, so these
 * totals were never computed over an empty fleet. Now that the dashboard is the landing view in
 * every state, an empty account is the FIRST thing a new operator sees — and the summary cards
 * must read 0, not NaN or "undefined".
 */
describe("fleetTotals", () => {
  it("reads zero for an account with no apps", () => {
    expect(fleetTotals([])).toEqual({ apps: 0, parameters: 0, revisions: 0, keys: 0 })
  })

  it("sums across apps", () => {
    expect(fleetTotals([
      app({ parameters: 3, keys: 2, liveVersion: 4 }),
      app({ parameters: 1, keys: 1, liveVersion: 2 }),
    ])).toEqual({ apps: 2, parameters: 4, revisions: 6, keys: 3 })
  })

  it("counts a never-published app as zero revisions rather than skipping it", () => {
    // liveVersion is null before the first publish. Treating null as "no row" would make the
    // app vanish from the apps count while its parameters still showed up in the totals.
    const t = fleetTotals([app({ liveVersion: null, parameters: 5 })])
    expect(t).toEqual({ apps: 1, parameters: 5, revisions: 0, keys: 0 })
  })
})
