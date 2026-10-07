/**
 * G-8c — a constraint violation must reach the operator as something they can act on.
 *
 * These constraints exist for good reasons (ties cannot decide resolution by row order; a
 * boolean parameter cannot hold "yes"), but their raw Postgres messages name an internal
 * constraint and say nothing about what to do. An operator meeting
 * `duplicate key value violates unique constraint "parameter_value_priority_unique"` learns
 * only that the product broke.
 *
 * The mapping lives in the server action, so this exercises that mapping directly against the
 * error shapes supabase-js actually returns.
 */
import { addOverride, createParameter } from "@/app/apps/[id]/parameters/actions"

// requireUser() reaches for cookies; stub it and the client so the mapping is what is tested.
let nextError: { code: string; message: string } | null = null

jest.mock("@/lib/require-user", () => ({
  requireUser: async () => ({
    user: { id: "u1" },
    supabase: {
      from: () => ({
        insert: async () => ({ error: nextError }),
      }),
    },
  }),
}))
jest.mock("next/cache", () => ({ revalidatePath: () => {} }))

beforeEach(() => { nextError = null })

test("a duplicate priority explains what to change, naming the number", async () => {
  nextError = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "parameter_value_priority_unique"',
  }
  const res = await addOverride("app-1", "p1", "boolean", { condition_id: "c1", value: "true", priority: 3 })
  expect("error" in res && res.error).toBeTruthy()
  const msg = (res as { error: string }).error
  expect(msg).toContain("Priority 3")
  expect(msg).toMatch(/lower wins/i)
  // The raw constraint name must not survive into the UI.
  expect(msg).not.toContain("parameter_value_priority_unique")
})

test("attaching the same condition twice is explained as such", async () => {
  nextError = { code: "23505", message: 'duplicate key value violates unique constraint "parameter_value_once_per_condition"' }
  const res = await addOverride("app-1", "p1", "boolean", { condition_id: "c1", value: "true", priority: 9 })
  expect((res as { error: string }).error).toMatch(/already attached/i)
})

test("a type mismatch is caught in the form, before it reaches the database", async () => {
  // No error is staged: the action must refuse this itself, because the CHECK would otherwise
  // produce a message about a constraint rather than about the value the operator typed.
  const res = await addOverride("app-1", "p1", "boolean", { condition_id: "c1", value: "yes", priority: 1 })
  expect((res as { error: string }).error).toMatch(/must be exactly "true" or "false"/)
})

test("a bad key shape is explained in words, not as a constraint name", async () => {
  const res = await createParameter("app-1", {
    key: "Welcome Banner", type: "boolean", default_value: "false", description: "",
  })
  expect((res as { error: string }).error).toMatch(/lower_snake_case/)
  expect((res as { error: string }).error).not.toMatch(/parameter_key_shape/)
})

test("invalid JSON for a json parameter says so plainly", async () => {
  const res = await createParameter("app-1", {
    key: "tiers", type: "json", default_value: "{not json}", description: "",
  })
  expect((res as { error: string }).error).toMatch(/not valid JSON/i)
})

test("a json default that is a bare scalar is refused", async () => {
  // `json` means object or array. A bare `5` would pass JSON.parse and then fail the CHECK.
  const res = await createParameter("app-1", {
    key: "tiers", type: "json", default_value: "5", description: "",
  })
  expect((res as { error: string }).error).toMatch(/object or an array/i)
})
