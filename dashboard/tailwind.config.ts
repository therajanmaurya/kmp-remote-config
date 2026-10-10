import type { Config } from "tailwindcss"

/**
 * Design tokens taken from the generated dashboard mockups
 * (idea-layer mockups, dashboard-remote-config, stitch screens, code.html).
 *
 * Copied verbatim rather than approximated: the mockups are the design source of truth, and an
 * "about right" indigo drifts from them on the first screen someone adds. The role names are the
 * mockups' own, so a value seen in a mockup can be found here by search.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // A real shimmer: a highlight band that TRAVELS across the placeholder. `animate-pulse`
      // only fades opacity up and down, which at rest reads as a dim box rather than as work in
      // progress — on a first load, where the whole screen is placeholder, that looked like the
      // page had rendered badly rather than like it was loading.
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
      },
      colors: {
        primary: "#4F46E5",
        on_primary: "#FFFFFF",
        primary_container: "#E0E7FF",
        on_primary_container: "#1E1B4B",
        secondary: "#475569",
        on_secondary: "#FFFFFF",
        secondary_container: "#E2E8F0",
        on_secondary_container: "#0F172A",
        tertiary: "#059669",
        on_tertiary: "#FFFFFF",
        tertiary_container: "#D1FAE5",
        on_tertiary_container: "#022C22",
        error: "#DC2626",
        on_error: "#FFFFFF",
        error_container: "#FEE2E2",
        on_error_container: "#450A0A",
        warning: "#D97706",
        on_warning: "#FFFFFF",
        warning_container: "#FEF3C7",
        on_warning_container: "#451A03",
        background: "#FFFFFF",
        on_background: "#0F172A",
        surface: "#FFFFFF",
        on_surface: "#0F172A",
        surface_variant: "#F8FAFC",
        on_surface_variant: "#475569",
        outline: "#CBD5E1",
        outline_variant: "#E2E8F0",
        code_background: "#0F172A",
        code_on_background: "#E2E8F0",
      },
      fontFamily: {
        headline: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { sm: "4px", DEFAULT: "6px", md: "8px", lg: "12px", xl: "16px" },
    },
  },
  plugins: [],
} satisfies Config
