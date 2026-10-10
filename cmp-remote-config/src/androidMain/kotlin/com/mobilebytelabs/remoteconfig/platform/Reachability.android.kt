package com.mobilebytelabs.remoteconfig.platform

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * ConnectivityManager, read synchronously.
 *
 * `NET_CAPABILITY_INTERNET` says the network is meant to reach the internet; `VALIDATED` says
 * Android has actually confirmed it does. Both are required — a captive portal satisfies the
 * first and not the second, and treating a portal as reachable is how an app sits waiting for
 * a request that will be intercepted.
 *
 * Needs no permission beyond ACCESS_NETWORK_STATE, which the SDK's own manifest contributes.
 */
actual fun currentReachability(): Reachability = runCatching {
    val ctx = RemoteConfigContext.get() ?: return@runCatching Reachability.Unknown
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        ?: return@runCatching Reachability.Unknown
    val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        // No active network at all. The one case worth short-circuiting.
        ?: return@runCatching Reachability.Unreachable
    val usable = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    if (usable) Reachability.Reachable else Reachability.Unreachable
    // A SecurityException (permission stripped by the host app) or a missing service must not
    // stop a fetch that might have worked.
}.getOrDefault(Reachability.Unknown)

/**
 * Nothing to start: this platform's check is a synchronous read, answered on demand.
 */
public actual fun startReachabilityMonitoring() = Unit
