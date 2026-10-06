"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/require-user"
import { slugify } from "@/lib/slug"

export async function createApp(formData: FormData) {
  const { user, supabase } = await requireUser()

  const display_name = String(formData.get("display_name") ?? "").trim()
  const platforms = formData.getAll("platforms").map(String)
  const slug = slugify(display_name)

  if (!display_name) return { error: "Name is required." }
  if (!slug) return { error: "That name has no letters or digits to build a slug from." }
  if (platforms.length === 0) return { error: "Choose at least one platform." }

  const { data, error } = await supabase
    .from("app")
    .insert({ owner_id: user.id, slug, display_name, platforms })
    .select("id")
    .single()

  if (error) {
    // The UNIQUE (owner_id, slug) violation is the one an operator can act on, so it gets
    // its own sentence. Everything else returns a generic message: a Postgres error string
    // carries constraint names and row values.
    if (error.code === "23505") {
      return { error: `You already have an app whose slug is "${slug}". Pick a different name.` }
    }
    return { error: "Could not create the app." }
  }

  // The owner must ALSO be a member: every RLS policy reads membership via is_app_member(),
  // and app_select is `is_app_member(id) OR owner_id = auth.uid()`. Without this row the
  // owner can see the app but none of its keys or configs. Migration 002's
  // app_owner_membership trigger may already have inserted it, so this is upsert-shaped.
  await supabase
    .from("app_member")
    .upsert({ app_id: data.id, user_id: user.id, role: "owner" }, { onConflict: "app_id,user_id" })

  revalidatePath("/")
  redirect(`/apps/${data.id}`)
}
