export const runtime = "edge"

import { NextResponse } from "next/server"

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]

export async function GET() {
  // A COUNT, never the names. Naming the absent variable tells an unauthenticated caller
  // exactly which credential this deployment is missing.
  const missing_count = REQUIRED.filter((k) => !process.env[k]).length
  return NextResponse.json({ ok: missing_count === 0, missing_count })
}
