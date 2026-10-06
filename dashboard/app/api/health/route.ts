export const runtime = "edge"

import { NextResponse } from "next/server"

/**
 * Reports whether this deployment has its three variables, as a COUNT — never the names.
 * Naming the absent variable tells an unauthenticated caller exactly which credential this
 * deployment is missing.
 *
 * The reads are LITERAL (`process.env.FOO`), not `process.env[name]` from a list. Next
 * substitutes NEXT_PUBLIC_* at build time via a static replacement that cannot see a
 * computed key, so the earlier list-driven version reported all three missing on a
 * correctly-configured deployment — observed live as {"ok":false,"missing_count":3} on
 * rconfig-8nq.pages.dev right after a successful deploy.
 *
 * They are read INSIDE the handler so the runtime-leak test can delete them per case.
 */
export async function GET() {
  const values = [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ]
  const missing_count = values.filter((v) => !v).length
  return NextResponse.json({ ok: missing_count === 0, missing_count })
}
