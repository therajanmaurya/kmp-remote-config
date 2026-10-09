package com.mobilebytelabs.remoteconfig.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.remoteconfig.model.DisplayType

/**
 * The design system the shipped templates render through.
 *
 * ── The problem it solves ────────────────────────────────────────────────────────────────────
 * Every surface used to render identically: a fullscreen takeover, a bottom sheet and a dialog
 * all drew `headlineSmall` titles, `bodyMedium` text and 12dp gaps. The result was a fullscreen
 * that read as a dialog which had lost its box — correct content, no sense that anyone had
 * considered the surface it was on.
 *
 * Surfaces differ in how much attention they command, and the type scale and rhythm should say
 * so before a single word is read:
 *
 *   BANNER       dense, peripheral. It sits inside the host's layout and must not shout.
 *   DIALOG       compact, one decision. Tight enough to read as a single question.
 *   BOTTOM_SHEET roomier. The user pulled it up, so it can afford to breathe.
 *   FULLSCREEN   hero. It took the whole screen; using dialog-sized type wastes the claim.
 *
 * ── Theme adoption is the default, not an option ─────────────────────────────────────────────
 * Every colour, type style and shape here is DERIVED from the host's `MaterialTheme`. A config
 * surface rendered inside a consumer's app should look like it belongs to that app, not like an
 * SDK that arrived with opinions. So there is no palette in this file, and no font: only the
 * decisions a remote-config surface genuinely has to make — which role to use at which size, and
 * how much air to leave between things.
 *
 * That also means a consumer who themes their app gets a themed config surface for free, and one
 * who does not gets Material defaults. Neither has to configure anything.
 *
 * ── Overriding ───────────────────────────────────────────────────────────────────────────────
 * [RemoteConfigDesignOverrides] is the escape hatch for a host whose brand needs something the
 * theme cannot express — a flatter corner, a taller tap target. It is deliberately small: a
 * surface that can be reshaped arbitrarily stops being predictable, and the templates' designs
 * assume a rhythm.
 */
@Immutable
public class RemoteConfigDesign internal constructor(
    /** Title role. Scales up with the surface's claim on attention. */
    public val titleStyle: TextStyle,
    /** Body role. One step up on the larger surfaces, where line length is longer. */
    public val bodyStyle: TextStyle,
    /** Supporting / caption role — timestamps, offer codes, the quiet second line. */
    public val detailStyle: TextStyle,
    /** Vertical rhythm between stacked elements. */
    public val gap: Dp,
    /** Inset from the surface's own edge to its content. */
    public val contentPadding: Dp,
    /** Height of the primary action. Larger surfaces carry larger targets. */
    public val actionHeight: Dp,
    /** Corner of the surface itself. */
    public val surfaceShape: Shape,
    /** Corner of controls inside it — buttons, inset cards. */
    public val controlShape: Shape,
    /** Eyebrow label size. */
    public val eyebrowSize: androidx.compose.ui.unit.TextUnit,
)

/**
 * The knobs a host may turn. Everything absent is taken from the theme.
 *
 * Deliberately NOT a full token set. Exposing every dimension would let a consumer produce a
 * surface the template designs do not hold together on, and the support burden of "my paywall
 * looks broken" lands here rather than there.
 */
@Immutable
public data class RemoteConfigDesignOverrides(
    /** Corner radius for surfaces. Null keeps the per-surface default derived from the theme. */
    public val surfaceCornerRadius: Dp? = null,
    /** Corner radius for buttons and inset cards. */
    public val controlCornerRadius: Dp? = null,
    /** Minimum height for the primary action, for hosts with stricter tap-target rules. */
    public val minActionHeight: Dp? = null,
)

internal val LocalRemoteConfigDesign = staticCompositionLocalOf<RemoteConfigDesign?> { null }

/** Host-supplied overrides, or the empty set. */
public val LocalRemoteConfigDesignOverrides =
    staticCompositionLocalOf { RemoteConfigDesignOverrides() }

/**
 * The design in force for the surface currently being rendered.
 *
 * Falls back to the DIALOG scale when read outside a surface — the most conservative of the
 * four, so a body rendered in an unexpected context is merely compact rather than enormous.
 */
internal val LocalDesign: RemoteConfigDesign
    @Composable @ReadOnlyComposable
    get() = LocalRemoteConfigDesign.current ?: designFor(DisplayType.DIALOG)

/**
 * Derive the design for one surface from the host's theme.
 *
 * The type ROLES are chosen, the type itself is the host's: a consumer who sets a brand font
 * gets it here without knowing this file exists.
 */
@Composable
@ReadOnlyComposable
internal fun designFor(display: DisplayType): RemoteConfigDesign {
    val t = MaterialTheme.typography
    val o = LocalRemoteConfigDesignOverrides.current

    // Per-surface metrics. The progression is deliberate and monotonic — a surface that claims
    // more of the screen gets more of everything — so the four read as one family rather than
    // four unrelated layouts.
    val (titleStyle, bodyStyle, detailStyle) = when (display) {
        DisplayType.BANNER -> Triple(t.titleSmall, t.bodySmall, t.labelSmall)
        DisplayType.DIALOG -> Triple(t.headlineSmall, t.bodyMedium, t.bodySmall)
        DisplayType.BOTTOM_SHEET -> Triple(t.headlineMedium, t.bodyLarge, t.bodyMedium)
        DisplayType.FULLSCREEN -> Triple(t.displaySmall, t.bodyLarge, t.bodyMedium)
    }

    val gap = when (display) {
        DisplayType.BANNER -> 6.dp
        DisplayType.DIALOG -> 12.dp
        DisplayType.BOTTOM_SHEET -> 16.dp
        DisplayType.FULLSCREEN -> 20.dp
    }

    val contentPadding = when (display) {
        DisplayType.BANNER -> 14.dp
        DisplayType.DIALOG -> 24.dp
        DisplayType.BOTTOM_SHEET -> 28.dp
        DisplayType.FULLSCREEN -> 32.dp
    }

    val actionHeight = when (display) {
        DisplayType.BANNER -> 36.dp
        DisplayType.DIALOG -> 48.dp
        DisplayType.BOTTOM_SHEET -> 52.dp
        DisplayType.FULLSCREEN -> 56.dp
    }.let { base -> o.minActionHeight?.let { maxOf(base, it) } ?: base }

    // Surface corner follows the host's shape scale where it has an opinion, because a brand
    // that squares off its cards means it for an overlay too.
    val surfaceShape = o.surfaceCornerRadius?.let { RoundedCornerShape(it) } ?: when (display) {
        DisplayType.BANNER -> MaterialTheme.shapes.medium
        DisplayType.DIALOG -> MaterialTheme.shapes.extraLarge
        DisplayType.BOTTOM_SHEET -> MaterialTheme.shapes.extraLarge
        DisplayType.FULLSCREEN -> MaterialTheme.shapes.extraSmall
    }

    val controlShape = o.controlCornerRadius?.let { RoundedCornerShape(it) }
        ?: MaterialTheme.shapes.medium

    return RemoteConfigDesign(
        titleStyle = titleStyle,
        bodyStyle = bodyStyle,
        detailStyle = detailStyle,
        gap = gap,
        contentPadding = contentPadding,
        actionHeight = actionHeight,
        surfaceShape = surfaceShape,
        controlShape = controlShape,
        eyebrowSize = when (display) {
            DisplayType.FULLSCREEN, DisplayType.BOTTOM_SHEET -> 12.sp
            else -> 11.sp
        },
    )
}

private val Int.sp get() = androidx.compose.ui.unit.TextUnit(
    this.toFloat(),
    androidx.compose.ui.unit.TextUnitType.Sp,
)
