"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase-browser"

/**
 * Clear stale Supabase auth artifacts before starting a fresh OAuth flow.
 *
 * Past failed flows (cancelled at Google, a network blip during PKCE exchange, stale
 * verifier cookies from an older @supabase/ssr) can leave the browser holding cookies and
 * localStorage keys that supabase-js still treats as current. Mixed into a new request,
 * GoTrue rejects with {"message":"Bad request"}.
 *
 * Safe unconditionally — nobody benefits from landing on the login page with a session
 * intact.
 */
function purgeStaleSupabaseAuthState() {
  if (typeof window === "undefined") return
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") || k.startsWith("supabase.")) localStorage.removeItem(k)
    }
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith("sb-") || k.startsWith("supabase.")) sessionStorage.removeItem(k)
    }
    document.cookie
      .split(";")
      .map((c) => c.trim().split("=")[0])
      .filter((n) => n.startsWith("sb-") || n.startsWith("supabase-"))
      .forEach((name) => {
        document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
        document.cookie = `${name}=; Path=/; Domain=${location.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
      })
  } catch {
    // localStorage throws in private mode / strict-cookie browsers — ignore.
  }
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function LoginPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    purgeStaleSupabaseAuthState()
    const p = new URLSearchParams(window.location.search).get("error")
    if (p) setError(p)
  }, [])

  async function signIn() {
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setError(error.message)
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">rconfig</h1>
          <p className="mt-1 text-sm text-secondary">Remote config for your apps.</p>
        </div>
        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <button
          onClick={signIn}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded border px-4 py-2.5 text-sm font-medium hover:bg-surface_variant disabled:opacity-60"
        >
          <GoogleIcon />
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>
    </main>
  )
}
