package com.mobilebytelabs.remoteconfig.ui.templates

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Parts every designed template body shares, so the nine surfaces look like one product.
 *
 * Deliberately built on MaterialTheme colours rather than the dashboard's own palette: these
 * render inside a CONSUMER's app, and an overlay that ignores the host theme reads as a
 * third-party advert rather than part of the product. The mockups show a particular brand
 * because they were drawn for one; what they actually specify is the STRUCTURE.
 */

/** The small uppercase label above a title — "NEW FEATURE", "FEEDBACK". */
@Composable
internal fun Eyebrow(text: String, tone: Color = MaterialTheme.colorScheme.primary) {
    Surface(
        shape = CircleShape,
        color = tone.copy(alpha = 0.12f),
        contentColor = tone,
    ) {
        Text(
            text = text.uppercase(),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.8.sp,
        )
    }
}

@Composable
internal fun TemplateTitle(text: String, modifier: Modifier = Modifier, center: Boolean = false) {
    Text(
        text = text,
        modifier = modifier.fillMaxWidth(),
        style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.Bold,
        textAlign = if (center) TextAlign.Center else TextAlign.Start,
    )
}

@Composable
internal fun TemplateBodyText(text: String, center: Boolean = false) {
    Text(
        text = text,
        modifier = Modifier.fillMaxWidth(),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = if (center) TextAlign.Center else TextAlign.Start,
    )
}

/**
 * A benefit / release-note row: a dot or glyph, a bold lead, an optional detail line.
 *
 * Used by the forced-update, paywall and what's-new designs, all of which present a short list
 * where each entry is "reassurance plus specifics".
 */
@Composable
internal fun BulletRow(lead: String, detail: String? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .padding(top = 6.dp, end = 10.dp)
                .size(6.dp)
                .background(MaterialTheme.colorScheme.primary, CircleShape),
        )
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = lead,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (detail != null) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Full-width primary action. */
@Composable
internal fun PrimaryAction(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        Text(label, fontWeight = FontWeight.SemiBold)
    }
}

/** The decline path. Rendered as a quiet text button so it never competes with the primary. */
@Composable
internal fun SecondaryAction(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun OutlinedAction(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(48.dp),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Text(label)
    }
}

/** An inset card — the search-bar illustration in the announcement design, offer codes, notes. */
@Composable
internal fun InsetCard(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
    ) {
        Box(modifier = Modifier.padding(14.dp)) { content() }
    }
}

@Composable
internal fun VSpace(height: Int) = Spacer(Modifier.height(height.dp))

/** Vertical stack with the spacing the designs use between blocks. */
@Composable
internal fun TemplateColumn(
    modifier: Modifier = Modifier,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = horizontalAlignment,
    ) { content() }
}
