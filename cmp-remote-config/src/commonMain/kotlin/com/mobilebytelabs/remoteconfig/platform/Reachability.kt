package com.mobilebytelabs.remoteconfig.platform

/**
 * What the platform believes about connectivity, before a request is attempted.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 * The first fetch waits up to ten seconds, because giving up early on a slow cold start means
 * an app silently serves bundled defaults and looks broken. That budget is right when the
 * network is merely slow, and wrong when there is demonstrably no network at all: then it is
 * ten seconds of waiting for an answer that cannot arrive.
 *
 * ── Why THREE states and not a boolean ──────────────────────────────────────────────────────
 * `Unknown` is the important one. A boolean forces every platform to claim something, and the
 * only safe lie is "connected" — which makes the type useless — or "disconnected", which would
 * stop a working app from ever fetching. Most of these targets have no cheap, reliable answer,
 * and saying so is better than guessing.
 *
 * Only [Unreachable] changes behaviour. [Unknown] and [Reachable] both proceed exactly as
 * before, so a platform with no implementation cannot regress.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────────────────────
 * Not a guarantee. [Reachable] means an interface is up, not that the internet works or that
 * this host resolves — captive portals and DNS failures still look reachable. The fetch and its
 * timeout remain the real test; this only skips the wait when the platform already knows the
 * answer. A reachability check used as a precondition for *whether to try* is the classic way
 * to build an app that refuses to work on a network it would actually have been fine on.
 */
public enum class Reachability {
    /** An interface is up. Says nothing about whether the request will succeed. */
    Reachable,

    /** The platform reports no usable network. The only state that short-circuits a fetch. */
    Unreachable,

    /** No cheap answer on this platform, or the check failed. Behaves exactly as before. */
    Unknown,
}

/**
 * Best-effort connectivity, cheap enough to call before every fetch.
 *
 * Implemented on Android (`ConnectivityManager`), Apple (`NWPathMonitor`) and the browser
 * (`navigator.onLine`). On the JVM, Linux and Windows it returns [Reachability.Unknown] — there
 * is no cheap, dependency-free answer, and a plausible-looking guess would skip fetches that
 * should have happened.
 *
 * Apple answers from a monitor started by [startReachabilityMonitoring]; before its first
 * callback arrives the answer is [Reachability.Unknown], which proceeds exactly as an
 * unimplemented platform would.
 */
public expect fun currentReachability(): Reachability

/**
 * Begin watching connectivity, if this platform needs to.
 *
 * Called once from `Module.remoteConfig { }` at DI setup. Idempotent, non-blocking, and a no-op
 * on every platform whose check is a synchronous read.
 *
 * It exists for Apple. `NWPathMonitor` is a watcher, not a probe: it reports the current path
 * through a callback shortly after starting and then on every change. A synchronous
 * [currentReachability] can only answer from what the monitor has already reported — so if the
 * monitor first starts when the first fetch asks, the answer is [Reachability.Unknown] and the
 * check does nothing on the one launch it was meant to help.
 *
 * Starting at DI setup gives it the span between Koin configuration and first composition,
 * which is far longer than the callback needs. The alternative — blocking the caller until the
 * first path update — would trade a ten-second timeout for a stall on whichever thread the
 * fetch happens to start from, which is a worse bargain.
 */
public expect fun startReachabilityMonitoring()
