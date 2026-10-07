package com.mobilebytesensei.rconfig

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.remoteconfig.model.ActionType
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

    // One fetch on first composition. A real app would also consult
    // `config.values.shouldFetch(lastFetchAt, now)` so the operator's interval and kill switch
    // are honoured — including from cache, which is the whole reason the switch works offline.
    LaunchedEffect(Unit) {
        refreshing = true
        lastResult = if (config.refresh(screen = "home")) "fetched" else config.lastRejection ?: "unavailable"
        refreshing = false
    }

    MaterialTheme {
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
                        "template ${active.template} · display ${active.display}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    // In a real app this is `RemoteConfigHost()`, which resolves the template's
                    // designed body and wraps it in the surface `display` names. It is shown as
                    // a description here because the Host reads its state from an injected Koin
                    // ViewModel, and wiring DI into a sample would obscure the integration this
                    // file exists to demonstrate.
                    SampleSurfacePlaceholder(
                        template = active.template,
                        onAction = { /* ActionDispatcher.dispatch(…) in a real app */ },
                    )
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

@Composable
private fun SampleSurfacePlaceholder(template: String, onAction: (ActionType) -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Box(modifier = Modifier.padding(16.dp)) {
            Text(
                "RemoteConfigHost() renders the \"$template\" body here, in the surface its " +
                    "display names.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
