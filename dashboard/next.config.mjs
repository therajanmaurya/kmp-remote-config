/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    /**
     * How long the client Router Cache may reuse a prefetched or already-visited segment.
     *
     * Next 14.2 ships `dynamic: 0`, which means every client navigation refetches EVERY segment
     * of the destination — including shared layouts that were already on screen and whose output
     * has not changed. For this dashboard that made moving from Configs to Keys re-run
     * `apps/[id]/layout.tsx` in full: an auth validation plus three queries (the app row, publish
     * status, the app list), none of which differ between two sections of the same app, all of
     * them ahead of the section you actually asked for.
     *
     * 30s is a deliberate middle: long enough that clicking around one app reuses the shell,
     * short enough that a publish or a new app shows up without a hard reload. The data that
     * genuinely changes per section lives in the PAGE segment, which is dynamic and still
     * refetched on every navigation — this only lets the unchanged shell be reused.
     *
     * This is only safe because the layout no longer reads `headers()`. While the active-section
     * highlight was derived server-side from the pathname, a reused layout would have kept
     * highlighting the row you navigated AWAY from — a cached-stale-UI bug that would have looked
     * like a rendering glitch rather than a caching setting. `SidebarNav` and
     * `ActiveSectionCrumb` now resolve it from `usePathname()` on the client, which is what makes
     * the layout reusable at all.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
}
export default nextConfig
