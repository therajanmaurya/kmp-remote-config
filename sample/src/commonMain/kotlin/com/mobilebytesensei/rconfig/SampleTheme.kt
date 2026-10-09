package com.mobilebytesensei.rconfig

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The sample's own theme — and the demonstration that the SDK has none of its own.
 *
 * ── Why this file matters more than it looks ─────────────────────────────────────────────────
 * Every screenshot of this product used to come out in Material's default purple. Not because
 * anyone chose purple, but because the sample defined no theme at all, so Compose supplied its
 * baseline seed. The config surfaces looked unstyled for exactly the same reason: they inherit
 * the host's `MaterialTheme`, and the host had nothing to inherit.
 *
 * So this is the proof of the SDK's central design claim. `RemoteConfigDesign` carries no
 * palette and no font; it derives everything from the host. Define a theme here and every
 * template — the paywall, the NPS sheet, the maintenance banner — adopts it with no SDK
 * configuration, no token mapping and no callback. If the surfaces below do NOT change colour
 * when this file changes, the claim is false and that is a bug worth finding.
 *
 * ── Where the colours come from ──────────────────────────────────────────────────────────────
 * Lifted from the dashboard's own palette (`dashboard/tailwind.config.ts`) rather than invented:
 * indigo primary, emerald tertiary, slate neutrals. A sample that looked like a different
 * product from the console an operator just used would undercut the thing it is demonstrating.
 *
 * ── Dark mode ────────────────────────────────────────────────────────────────────────────────
 * Not a tint of the light scheme. The container roles invert — a light scheme's pale
 * `primaryContainer` becomes a deep one, because a pale chip on a dark surface is a hole in the
 * screen. The templates use `primaryContainer` for eyebrows and `surfaceVariant` for inset
 * cards, so getting these wrong is immediately visible on the surfaces this sample exists to
 * show.
 */

// ── Brand ────────────────────────────────────────────────────────────────────────────────────
private val Indigo = Color(0xFF4F46E5)
private val IndigoContainer = Color(0xFFE0E7FF)
private val IndigoOnContainer = Color(0xFF1E1B4B)
private val Emerald = Color(0xFF059669)
private val EmeraldContainer = Color(0xFFD1FAE5)
private val EmeraldOnContainer = Color(0xFF022C22)
private val Slate900 = Color(0xFF0F172A)
private val Slate600 = Color(0xFF475569)
private val Slate200 = Color(0xFFE2E8F0)
private val Slate100 = Color(0xFFF8FAFC)
private val Slate300 = Color(0xFFCBD5E1)
private val Red = Color(0xFFDC2626)
private val RedContainer = Color(0xFFFEE2E2)
private val RedOnContainer = Color(0xFF450A0A)

private val LightColors = lightColorScheme(
    primary = Indigo,
    onPrimary = Color.White,
    primaryContainer = IndigoContainer,
    onPrimaryContainer = IndigoOnContainer,
    secondary = Slate600,
    onSecondary = Color.White,
    secondaryContainer = Slate200,
    onSecondaryContainer = Slate900,
    // Emerald is the "healthy / positive" role, and nothing more is asked of it.
    //
    // An earlier version of this comment argued tertiary "also has to read as a caution
    // colour", because the incident template mapped `severity: warning` onto it — which meant
    // a degraded-service banner rendered GREEN under this theme. That was defending the bug
    // rather than seeing it. The SDK now pins its own caution amber, because severity is
    // meaning the host must not be able to redefine by picking a palette.
    tertiary = Emerald,
    onTertiary = Color.White,
    tertiaryContainer = EmeraldContainer,
    onTertiaryContainer = EmeraldOnContainer,
    error = Red,
    onError = Color.White,
    errorContainer = RedContainer,
    onErrorContainer = RedOnContainer,
    background = Color.White,
    onBackground = Slate900,
    surface = Color.White,
    onSurface = Slate900,
    surfaceVariant = Slate100,
    onSurfaceVariant = Slate600,
    outline = Slate300,
    outlineVariant = Slate200,
)

private val DarkColors = darkColorScheme(
    // Lightened for contrast against a dark surface. The brand indigo at full saturation fails
    // WCAG AA on near-black, so the dark scheme uses the tint rather than the base.
    primary = Color(0xFFA5B4FC),
    onPrimary = Color(0xFF1E1B4B),
    primaryContainer = Color(0xFF312E81),
    onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = Color(0xFFCBD5E1),
    onSecondary = Slate900,
    secondaryContainer = Color(0xFF334155),
    onSecondaryContainer = Slate200,
    tertiary = Color(0xFF6EE7B7),
    onTertiary = Color(0xFF022C22),
    tertiaryContainer = Color(0xFF065F46),
    onTertiaryContainer = EmeraldContainer,
    error = Color(0xFFFCA5A5),
    onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = RedContainer,
    background = Color(0xFF0B1120),
    onBackground = Slate100,
    // Deliberately a step LIGHTER than background. Compose draws overlay surfaces on top of the
    // background, and a surface identical to it makes a dialog's edge disappear — the shadow is
    // the only thing separating them, and shadows read poorly on dark.
    surface = Color(0xFF111827),
    onSurface = Slate100,
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF475569),
    outlineVariant = Color(0xFF334155),
)

/**
 * A tightened type scale on the platform's default family.
 *
 * No font binary is shipped: a sample that drags a 300KB typeface into every consumer's checkout
 * to look nicer in screenshots is a poor trade, and the SDK reads whatever family the host sets
 * either way. What IS set is the part that actually makes default type look unconsidered —
 * weights, line heights and letter spacing, which Material's baseline leaves loose for display
 * roles.
 */
private val SampleTypography = Typography().run {
    copy(
        displaySmall = displaySmall.copy(
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.5).sp,
            lineHeight = 40.sp,
        ),
        headlineMedium = headlineMedium.copy(
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.3).sp,
        ),
        headlineSmall = headlineSmall.copy(
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.2).sp,
        ),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.copy(fontWeight = FontWeight.SemiBold),
        // Body copy in these surfaces is dense and often two or three lines; the baseline
        // line-height makes it look crowded at the width a dialog allows.
        bodyLarge = bodyLarge.copy(lineHeight = 26.sp),
        bodyMedium = bodyMedium.copy(lineHeight = 22.sp),
        labelLarge = labelLarge.copy(fontWeight = FontWeight.SemiBold),
    )
}

/**
 * Shapes. `extraLarge` is what the SDK's dialog and bottom-sheet surfaces read, and `medium`
 * is what its buttons and inset cards read — so these three values reshape every config surface
 * without the SDK exposing a single corner-radius knob.
 */
private val SampleShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(18.dp),
    extraLarge = RoundedCornerShape(26.dp),
)

@Composable
fun SampleTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = SampleTypography,
        shapes = SampleShapes,
        content = content,
    )
}
