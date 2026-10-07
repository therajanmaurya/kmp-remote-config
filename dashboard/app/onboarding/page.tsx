export const runtime = "edge"

import { requireUser } from "@/lib/require-user"
import { OnboardingWizard } from "@/components/OnboardingWizard"

export default async function OnboardingPage() {
  const { supabase } = await requireUser()
  const { count } = await supabase.from("app").select("id", { count: "exact", head: true })
  // The copy differs for a first app vs a fifth — "Register your first app" is wrong once
  // somebody has four, and generic copy wastes the one moment they need orientation.
  return <OnboardingWizard firstRun={(count ?? 0) === 0} />
}
