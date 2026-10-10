package com.mobilebytesensei.rconfig

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.remoteconfig.ui.RemoteConfigHost
import com.mobilebytelabs.remoteconfig.ui.RemoteConfigSurface
import com.mobilebytelabs.remoteconfig.model.DisplayType
import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem
import kotlinx.coroutines.launch

/**
 * The sample screen, demonstrating BOTH halves of the SDK in one place:
 *
 *  - **values** — typed reads through `RemoteConfigClient`. Pure Kotlin, no Compose involved;
 *    the identical calls work in a server, a CLI, or a watch complication.
 *  - **surfaces** — a delivered UI config rendered by the Compose layer.
 *
 * Keeping them visibly separate is the point. A host app usually wants the first and only
 * sometimes the second, and the library is split into two artefacts precisely so taking the
 * values does not drag a renderer onto a target that has no Compose runtime.
 */
@Composable
fun SampleScreen(config: SampleRemoteConfig) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var lastResult by remember { mutableStateOf<String?>(null) }
    // Which template the gallery is currently rendering, or null for none.
    var preview by remember { mutableStateOf<RemoteConfigItem?>(null) }

    // One fetch on first composition. A real app would also consult
    // `config.values.shouldFetch(lastFetchAt, now)` so the operator's interval and kill switch
    // are honoured — including from cache, which is the whole reason the switch works offline.
    LaunchedEffect(Unit) {
        refreshing = true
        lastResult = if (config.refresh(screen = "home")) "fetched" else config.lastRejection ?: "unavailable"
        refreshing = false
    }

    SampleTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("rconfig sample", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    SampleConfig.APPLICATION_ID,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                // ── the headless half ──────────────────────────────────────────
                Text("Values", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Read through the typed getters. Before any fetch lands these are the app's " +
                        "BUNDLED defaults — without them a first launch with no network would show " +
                        "nothing, which is worse than having no remote config at all.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                ValueRow("welcome_banner_enabled", config.values.getBoolean("welcome_banner_enabled")?.toString())
                ValueRow("max_upload_mb", config.values.getLong("max_upload_mb")?.toString())
                ValueRow("checkout_copy", config.values.getString("checkout_copy"))

                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        enabled = !refreshing,
                        onClick = {
                            scope.launch {
                                refreshing = true
                                lastResult = if (config.refresh(screen = "home")) "fetched" else config.lastRejection ?: "unavailable"
                                refreshing = false
                            }
                        },
                    ) { Text(if (refreshing) "Fetching…" else "Fetch") }

                    // A REFUSAL is shown, not swallowed. The 3.5.28 SDK returned an empty list
                    // for every failure, so a revoked key and "nothing to show" looked identical
                    // — the exact defect this product exists to remove.
                    lastResult?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (it == "fetched") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        )
                    }
                }

                // ── the Compose half ───────────────────────────────────────────
                Text("Surfaces", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

                // DELIVERY: whichever single config the evaluator chose for this device right
                // now, rendered through the real Host. This is what a user would actually see,
                // and the one line a host app writes.
                val active = config.activeConfig
                if (active == null) {
                    Text(
                        "No UI config is eligible right now. That is a normal state: the evaluator " +
                            "drops value-only configs, and applies impression caps, dismissal and " +
                            "cooldown on top of what the server already targeted.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text(
                        "active: ${active.template} \u00b7 ${active.display}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    // Unscoped: whatever the evaluator picked, app-wide. A real screen usually
                    // names what it hosts instead —
                    //
                    //     RemoteConfigHost(Template.UpdateAvailable, Template.PolicyUpdate)
                    //
                    // which bounds this screen to those templates and lets a paywall live on
                    // the screen that actually sells something. This sample stays unscoped on
                    // purpose: its job is to show whatever the operator published.
                    RemoteConfigHost()
                }

                // GALLERY: every template the control plane delivered, on demand.
                //
                // Deliberately separate from the Host above. The Host answers "what does THIS
                // user see", which is one item after impression caps and cooldown; the gallery
                // answers "what does each template look like", which is the question a sample
                // exists to answer. Rendering them through the same path would mean opening the
                // gallery consumed the impressions a real user was owed — max_impressions
                // defaults to 1.
                // Split by whether the config RENDERS. `feature_flag` has display "none" and
                // renders_ui=false, so DisplayType.from() returns null and RemoteConfigSurface
                // draws nothing — putting it in the tappable list made a row that silently did
                // nothing when pressed, which is the dead-clickable class this product's own
                // rules forbid. It is reported instead, because it IS delivered and hiding it
                // would misrepresent the envelope.
                val delivered = config.deliveredConfigs
                val renderable = delivered.filter { DisplayType.from(it.display) != null }
                val valueOnly = delivered.size - renderable.size
                if (renderable.isNotEmpty()) {
                    Text(
                        "Templates",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        "${renderable.size} of ${delivered.size} delivered configs render a surface. " +
                            "Tap one to see it. " +
                            "These use RemoteConfigSurface, which draws a config the APP chose " +
                            "rather than the one the evaluator picked \u2014 so previewing one " +
                            "does not spend the impression a real user is owed.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    for (item in renderable) {
                        TextButton(
                            onClick = { preview = if (preview?.id == item.id) null else item },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                "${item.template}  \u00b7  ${item.display}",
                                modifier = Modifier.weight(1f),
                                style = MaterialTheme.typography.bodyMedium,
                                textAlign = TextAlign.Start,
                            )
                            Text(
                                if (preview?.id == item.id) "hide" else "show",
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }

                    // Rendered OUTSIDE the list so a dialog or bottom sheet is not nested inside
                    // a scrolling column, which clips it.
                    preview?.let { item ->
                        RemoteConfigSurface(
                            item = item,
                            onDismiss = { preview = null },
                        )
                    }

                    if (valueOnly > 0) {
                        Text(
                            "$valueOnly value-only config(s) also arrived \u2014 feature_flag and " +
                                "friends carry no surface, so the evaluator drops them from UI " +
                                "delivery and there is nothing to render.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ValueRow(key: String, value: String?) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(key, style = MaterialTheme.typography.bodyMedium)
        Text(
            value ?: "—",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (value == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
    }
}

