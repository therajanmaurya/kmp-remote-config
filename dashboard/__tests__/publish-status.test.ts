import { getPublishStatus } from "@/lib/publish-status"

/**
 * The staged-change diff is what the unpublished pill counts and what the publish page shows.
 * Its failure mode is silent by construction: a field the diff does not compare is a change an
 * operator makes, sees no warning about, and publishes without reviewing.
 *
 * `rollout_percentage` is the sharpest case. It was omitted when Phase 05 added the column, so
 * taking a config from 10% to 100% — the most consequential single edit in this product — staged
 * nothing and the dashboard reported no pending changes.
 */

type Row = Record<string, unknown>

/** Minimal stand-in for the two queries getPublishStatus issues. */
function fakeSupabase(published: Row[] | null, drafts: Row[]) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const self = new Proxy(chain, {
        get(_t, prop) {
          if (prop === "maybeSingle") {
            return async () => ({ data: published === null ? null : { version: 1, content: published } })
          }
          if (prop === "order" && table === "config") {
            // The drafts query ends at .order(...), so resolve there.
            return () => Promise.resolve({ data: drafts })
          }
          if (prop === "then") return undefined
          return () => self
        },
      })
      return self
    },
  } as never
}

const base = {
  id: "c1",
  template_id: "announcement",
  payload: { title: "hello" },
  display: "dialog",
  priority: 0,
  is_enabled: true,
  rollout_percentage: 100,
  cohort: null,
}

test("an identical draft stages nothing", async () => {
  const { staged } = await getPublishStatus(fakeSupabase([base], [base]), "app-1")
  expect(staged).toHaveLength(0)
})

test("a rollout change stages as a modification", async () => {
  // The regression. Before rollout_percentage was compared, this returned [].
  const { staged } = await getPublishStatus(
    fakeSupabase([base], [{ ...base, rollout_percentage: 20 }]),
    "app-1",
  )
  expect(staged).toHaveLength(1)
  expect(staged[0].kind).toBe("modified")
  expect(staged[0].before).toMatchObject({ rollout_percentage: 100 })
  expect(staged[0].after).toMatchObject({ rollout_percentage: 20 })
})

test("a cohort change stages", async () => {
  const { staged } = await getPublishStatus(
    fakeSupabase([base], [{ ...base, cohort: "beta" }]),
    "app-1",
  )
  expect(staged).toHaveLength(1)
})

test("a payload change stages", async () => {
  const { staged } = await getPublishStatus(
    fakeSupabase([base], [{ ...base, payload: { title: "edited" } }]),
    "app-1",
  )
  expect(staged).toHaveLength(1)
  expect(staged[0].kind).toBe("modified")
})

test("a config that is no longer an enabled draft stages as removed", async () => {
  // Disabling or deleting a config is a change devices will see, and the one most easily
  // forgotten before a publish — there is no row left to carry an updated_at.
  const { staged } = await getPublishStatus(fakeSupabase([base], []), "app-1")
  expect(staged).toHaveLength(1)
  expect(staged[0].kind).toBe("removed")
})

test("a brand-new draft stages as new", async () => {
  const { staged } = await getPublishStatus(fakeSupabase([], [base]), "app-1")
  expect(staged).toHaveLength(1)
  expect(staged[0].kind).toBe("new")
})

test("an app that has never published stages every enabled draft", async () => {
  const { staged, liveVersion } = await getPublishStatus(fakeSupabase(null, [base]), "app-1")
  expect(liveVersion).toBeNull()
  expect(staged).toHaveLength(1)
})
