// Cloudflare Pages via @cloudflare/next-on-pages runs every dynamic route in the Workers
// edge runtime, and the build REFUSES any non-static route that has not opted in. This is
// not a preference — without it the deploy fails listing this file.
export const runtime = "edge"

import { SchemaBuilder } from "@/components/SchemaBuilder"

export default function NewTemplatePage({ params }: { params: { id: string } }) {
  return <SchemaBuilder appId={params.id} />
}
