// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in.
export const runtime = "edge"

import { redirect } from "next/navigation"

/**
 * `/` is the organisation dashboard.
 *
 * It no longer auto-selects a single app. That shortcut made sense when the only surface was
 * per-app, but the matrix is the landing view now: it answers "which of my apps has unpublished
 * changes" and "which has never published", and skipping past it to one app hides exactly that.
 */
export default function RootPage() {
  redirect("/dashboard")
}
