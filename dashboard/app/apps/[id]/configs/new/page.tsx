import { requireUser } from "@/lib/require-user"
import { AuthoringForm, type TemplateRow } from "@/components/AuthoringForm"

export default async function NewConfigPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireUser()

  // Builtins plus this app's own custom templates. Never a hardcoded list — the 15 are
  // seeded by migration 004 and a 16th must appear here for free.
  const { data: templates } = await supabase
    .from("template")
    .select(
      "id, display_name, description, payload_schema, allowed_displays, renders_ui, requires_ack, min_sdk_version, is_builtin",
    )
    .or(`is_builtin.eq.true,app_id.eq.${params.id}`)
    .order("is_builtin", { ascending: false })
    .order("display_name")

  return <AuthoringForm appId={params.id} templates={(templates ?? []) as TemplateRow[]} />
}
