import type { Metadata } from "next"
import "./globals.css"

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
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface_variant font-body text-on_surface antialiased">{children}</body>
    </html>
  )
}
