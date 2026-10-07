import Link from "next/link"

/**
 * Persistent top-bar affordance, rendered by the app layout on EVERY app route.
 *
 * The server gate means an unpublished edit cannot reach a device. That closes the dangerous
 * failure but opens a quieter one: an operator edits, nothing contradicts them, and they
 * leave believing it shipped. This pill is the only thing standing between those two states,
 * so it cannot live on the publish page — a warning you only see once you go looking warns
 * nobody. Absent when there is nothing staged, so it never becomes background furniture.
 */
export function UnpublishedPill({ appId, count }: { appId: string; count: number }) {
  if (count < 1) return null
  return (
    <Link
      href={`/apps/${appId}/publish`}
      data-testid="unpublished-pill"
      className="inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning_container px-3 py-1 text-sm font-medium text-on_warning_container hover:border-warning"
    >
      <span className="h-2 w-2 rounded-full bg-warning_container0" aria-hidden />
      {count} unpublished {count === 1 ? "change" : "changes"}
    </Link>
  )
}
