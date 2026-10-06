import { keyBadge } from "@/lib/key-display"

/**
 * O4: keys stay re-displayable because they are publishable and ship inside the client.
 * That makes the BADGE the only thing separating a live key from a revoked one on screen,
 * which is why it is a tested function and not a className.
 */
describe("keyBadge", () => {
  it("marks a live, active key as live", () => {
    expect(keyBadge({ environment: "live", revoked_at: null })).toEqual({ label: "live", tone: "live" })
  })

  it("marks a test key as test, never as live", () => {
    const b = keyBadge({ environment: "test", revoked_at: null })
    expect(b.label).toBe("test")
    expect(b.tone).not.toBe("live")
  })

  it("revoked beats environment — a revoked live key must not read as live", () => {
    // The dangerous render: an operator sees "live", assumes traffic works, and debugs the
    // SDK for an afternoon while the server is returning 403.
    expect(keyBadge({ environment: "live", revoked_at: "2026-10-05T00:00:00Z" }))
      .toEqual({ label: "revoked", tone: "revoked" })
    expect(keyBadge({ environment: "test", revoked_at: "2026-10-05T00:00:00Z" }).label).toBe("revoked")
  })
})
