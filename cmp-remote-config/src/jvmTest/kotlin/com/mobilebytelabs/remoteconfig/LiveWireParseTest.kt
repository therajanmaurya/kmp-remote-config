package com.mobilebytelabs.remoteconfig

import com.mobilebytelabs.remoteconfig.model.RemoteConfigEnvelope
import kotlinx.serialization.json.Json
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 01 / T5 — parse a body captured from the DEPLOYED control plane with the shipped model.
 *
 * `ContractFixtureTest` asserts a fixture that a human wrote. This asserts what the live
 * function actually returned. The two catch different things: the fixture catches a model that
 * disagrees with the agreed contract, this catches a DEPLOYED function that disagrees with the
 * fixture — a migration applied to prod but never reflected in the committed contract, which no
 * amount of local testing would surface.
 *
 * Driven by `supabase/tests/e2e_sdk_contract.sh`, which captures the body and passes its path:
 *
 *   ./gradlew :cmp-remote-config:jvmTest --tests '*LiveWireParseTest*' -Drc.live.body=/path/to/body.json
 *
 * With the property absent the test SKIPS rather than fails, so `allTests` stays runnable with
 * no network and no credentials. A skip is visible in the report; a silent pass would not be.
 */
class LiveWireParseTest {

    private val bodyPath: String? = System.getProperty("rc.live.body")

    /**
     * Strict on purpose: `ignoreUnknownKeys` is FALSE here, the opposite of the SDK's own
     * lenient reader. The SDK must tolerate a field it does not know so an old client survives
     * a new server — but this check exists to NOTICE that, loudly, at the moment the deployed
     * function grows a field the committed model has never seen. Tolerating it here would make
     * the test incapable of reporting the only drift it was written to find.
     */
    private val strict = Json { ignoreUnknownKeys = false; isLenient = false }

    @Test
    fun the_deployed_response_parses_into_the_shipped_model() {
        val path = bodyPath ?: run {
            println("SKIP LiveWireParseTest: -Drc.live.body not set (run supabase/tests/e2e_sdk_contract.sh)")
            return
        }
        val body = File(path).readText()
        assertTrue(body.isNotBlank(), "captured body at $path is empty")

        val envelope = strict.decodeFromString<RemoteConfigEnvelope>(body)

        assertEquals(1, envelope.schemaVersion, "deployed schema_version drifted from the SDK's")
        assertTrue(
            envelope.configs.isNotEmpty(),
            "the live plane returned zero configs — the sentinel seed did not reach the fetch, " +
                "so this run proves nothing about the wire shape",
        )
        // Every delivered item must name a template and a display. Either being blank means the
        // model mapped a renamed column onto its default — a parse that succeeded while losing
        // the field, which is exactly the failure a value-blind check would wave through.
        envelope.configs.forEach { item ->
            assertTrue(item.id.isNotBlank(), "config id missing: $item")
            assertTrue(item.template.isNotBlank(), "config template missing: $item")
            assertTrue(item.display.isNotBlank(), "config display missing: $item")
        }
    }
}
