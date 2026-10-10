import { normalizeInviteEmail } from "@/lib/invite-email"

/**
 * One half of a match whose other half is in Postgres. `invitation_accept_pending` compares
 * against `lower(trim(auth.jwt() ->> 'email'))`, and the `app_invitation` CHECK requires the
 * stored value to equal `lower(btrim(email))`. If this side ever stops agreeing, there is no
 * error to find: the invitation is written, the person signs in, and they get nothing.
 */
describe("normalizeInviteEmail", () => {
  test("lowercases, because the sign-in side does", () => {
    const r = normalizeInviteEmail("Alice@Example.COM")
    expect(r).toEqual({ ok: true, email: "alice@example.com" })
  })

  test("trims, because a pasted address carries whitespace", () => {
    expect(normalizeInviteEmail("  bob@example.com \n")).toEqual({ ok: true, email: "bob@example.com" })
  })

  test("the stored form satisfies the table's CHECK", () => {
    // CHECK (email = lower(btrim(email))) — a value this function produced must be insertable,
    // or every invite 23514s at the database with nothing useful shown to the operator.
    for (const raw of ["  Carol@Example.com", "dave@sub.example.co.uk", "ERIN+tag@example.com"]) {
      const r = normalizeInviteEmail(raw)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.email).toBe(r.email.trim().toLowerCase())
    }
  })

  test("plus-addressing survives", () => {
    // A common way to sign up; rejecting it would be a self-inflicted support ticket.
    expect(normalizeInviteEmail("erin+rconfig@example.com")).toEqual({
      ok: true, email: "erin+rconfig@example.com",
    })
  })

  test("obvious non-addresses are refused with something readable", () => {
    for (const bad of ["", "   ", "nobody", "no@domain", "two @spaces.com", "a@b@c.com"]) {
      const r = normalizeInviteEmail(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10)
    }
  })
})
