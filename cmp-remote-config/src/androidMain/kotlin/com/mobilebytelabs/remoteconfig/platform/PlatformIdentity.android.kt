/*
 * Copyright 2026 MobileByteLabs · Apache 2.0
 */
package com.mobilebytelabs.remoteconfig.platform

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import java.security.MessageDigest

internal actual fun platformName(): String = "android"

/**
 * SHA-256 of this APK's signing certificate, uppercase colon-separated.
 *
 * `runCatching` on purpose: a null digest produces a server refusal the SDK already surfaces
 * (`cert_mismatch`), whereas an exception here would be thrown out of a Koin module during app
 * startup and crash the host. A refusal is diagnosable; a crash on launch is not.
 */
internal actual fun platformSigningDigest(): String? = runCatching {
    val ctx = RemoteConfigContext.get() ?: return@runCatching null
    val pm = ctx.packageManager
    @Suppress("DEPRECATION")
    val flags =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
        else PackageManager.GET_SIGNATURES
    val info = pm.getPackageInfo(ctx.packageName, flags)
    @Suppress("DEPRECATION")
    val signature =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners?.firstOrNull()
        else info.signatures?.firstOrNull()
    val der = signature?.toByteArray() ?: return@runCatching null
    MessageDigest.getInstance("SHA-256").digest(der).joinToString(":") { "%02X".format(it) }
}.getOrNull()

/**
 * The application Context, captured without asking the consumer for it.
 *
 * A ContentProvider is instantiated by the framework before `Application.onCreate`, which makes
 * it the standard zero-configuration hook for a library that needs a Context — it is the same
 * mechanism `androidx.startup` and multiplatform-settings-no-arg use underneath, chosen here to
 * avoid adding a dependency for four lines of work.
 *
 * Deliberately NOT a public init call. `RemoteConfig.init(context)` would be one more thing a
 * consumer can forget, and forgetting it reproduces exactly the silent-defaults failure this
 * whole change exists to remove.
 */
internal object RemoteConfigContext {
    @Volatile private var appContext: Context? = null
    internal fun set(context: Context) { appContext = context.applicationContext }
    internal fun get(): Context? = appContext
}

/** @suppress — registered in the library manifest; never referenced by a consumer. */
public class RemoteConfigInitProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        context?.let { RemoteConfigContext.set(it) }
        return true
    }

    // A ContentProvider used purely as an initialization hook exposes no data. Every operation
    // is a no-op rather than an exception: a stray query from a content-scanning tool should not
    // crash the host app.
    override fun query(u: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?): Int = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?): Int = 0
}
