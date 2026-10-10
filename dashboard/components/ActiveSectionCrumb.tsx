"use client"

import { usePathname } from "next/navigation"

/**
 * The last breadcrumb segment, resolved on the client.
 *
 * Same reason as `SidebarNav`: this used to be the `active` string the `/apps/[id]` layout
 * derived from `headers()`, and that single read is what made the layout non-reusable across
 * its own children. Both consumers had to move together — leaving either one reading the
 * pathname on the server would have kept the layout re-rendering on every navigation while
 * looking like it had been fixed.
 */
const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  apps: "Apps",
  community: "Community templates",
  tokens: "Access Tokens",
  members: "Members",
  parameters: "Parameters",
  conditions: "Conditions",
  configs: "Configs",
  templates: "Templates",
  preview: "Preview",
  history: "Activity",
  publish: "Publish",
  keys: "Keys",
}

export function ActiveSectionCrumb({ appId, bold }: { appId?: string; bold?: boolean }) {
  const pathname = usePathname() ?? ""

  // Inside an app, the id itself is not a section and `apps` is already shown as the crumb
  // before this one — so only the part AFTER `/apps/{id}` is considered, and an app root falls
  // back to "Overview" rather than echoing "Apps" a second time.
  const rest = appId ? pathname.replace(`/apps/${appId}`, "") : pathname

  const seg = rest
    .split("/")
    .filter(Boolean)
    .reverse()
    .find((s) => s in LABELS)

  const label = seg ? LABELS[seg] : appId ? "Overview" : ""

  return (
    <span className={`truncate ${bold ? "font-semibold" : "text-secondary"}`}>{label}</span>
  )
}
