import type { Metadata } from "next"
import "./globals.css"

/**
 * Every Material Symbol the dashboard renders. Keep sorted; see the note on the stylesheet
 * link below for why this list exists rather than loading the whole font.
 */
const ICON_NAMES = [
  "bolt", "check_circle", "chevron_right", "dashboard_customize", "deployed_code",
  "history", "info", "key", "layers", "open_in_new", "preview", "rocket_launch",
  "rule", "tune",
] as const

export const metadata: Metadata = {
  title: "rconfig",
  description: "Remote config for your apps.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter + JetBrains Mono are the mockups' typefaces; the icon font is what the
            mockups use for every nav and action glyph. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {/*
          `icon_names` is NOT optional here. Without it Google serves the FULL variable font —
          every Material Symbol in existence — which measured 4,003,092 bytes on the live site
          and was by far the largest thing the dashboard downloaded. Subset to the icons this
          app actually renders it is 19,176 bytes: a 99.5% reduction from one query parameter.

          Adding an icon to the UI means adding it to this list, or it renders as its literal
          ligature text ("rocket_launch") instead of a glyph — visible immediately, which is
          why this is a safe trade against shipping 4MB to every visitor.
        */}
        <link
          href={
            "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" +
            "&icon_names=" + ICON_NAMES.join(",") +
            "&display=block"
          }
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface_variant font-body text-on_surface antialiased">{children}</body>
    </html>
  )
}
