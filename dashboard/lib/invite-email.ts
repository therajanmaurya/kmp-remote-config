/**
 * Normalise and validate an invited address.
 *
 * This is extracted and tested on its own because it is half of a MATCH, and the other half
 * lives in Postgres (`invitation_accept_pending` lowercases `auth.jwt() ->> 'email'`). If the
 * two halves ever disagree on case or whitespace, nothing errors anywhere: the invitation is
 * written, the person signs in, and they simply get no access. There is no failing request to
 * look at — the only symptom is an invitation that stays pending forever.
 *
 * So both sides do exactly one thing — trim, then lowercase — and this file is where that
 * decision is written down and pinned.
 */
export type InviteEmail = { ok: true; email: string } | { ok: false; error: string }

// Deliberately permissive. Email syntax is far more varied than the familiar pattern suggests
// (quoted local parts, plus-addressing, long TLDs), and the real check happens at sign-in: an
// address nobody can authenticate with simply never claims its invitation. This exists to catch
// a typo or a pasted name, not to adjudicate RFC 5322.
const SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeInviteEmail(raw: string): InviteEmail {
  const email = raw.trim().toLowerCase()
  if (!email) return { ok: false, error: "Enter an email address." }
  if (!SHAPE.test(email)) return { ok: false, error: "That does not look like an email address." }
  return { ok: true, email }
}
