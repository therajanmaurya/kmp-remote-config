package com.mobilebytelabs.remoteconfig

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Closes a drift hole the inlined [ContractFixtureTest] cannot.
 *
 * `commonTest` has no filesystem on js/wasmJs/native, so ContractFixtureTest inlines the
 * fixture — which means it would keep passing against a stale copy of its own string even
 * after `contract/configs-response.json` changed. The Deno twin compares that FILE against
 * the serializer, so the uncovered case is: serializer and file change together, Kotlin
 * keeps asserting the old inline bytes, and nobody notices.
 *
 * This test reads the real file on the JVM target and asserts the same facts, so the
 * three-way agreement (serializer ↔ file ↔ Kotlin model) is actually enforced. The contract
 * is JSON shape, which is target-independent, so proving it on one target is sufficient.
 */
class ContractFixtureFileTest {

    private fun locateFixture(): File {
        // Gradle's test working directory is the module dir; walk up to the repo root so
        // the test does not depend on how it was invoked.
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val f = File(dir, "contract/configs-response.json")
            if (f.isFile) return f
            dir = dir.parentFile
        }
        fail("contract/configs-response.json not found walking up from ${File("").absolutePath}")
    }

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Test
    fun fixture_file_exists_and_is_the_shape_the_sdk_expects() {
        val root = json.parseToJsonElement(locateFixture().readText()).jsonObject
        assertEquals(1, root["schema_version"]!!.jsonPrimitive.content.toInt())

        val configs = root["configs"]!!.jsonArray
        assertEquals(2, configs.size, "fixture must cover one rendering config and one flag")

        val rendering = configs[0].jsonObject
        assertEquals("update_available", rendering["template"]!!.jsonPrimitive.content)
        assertTrue(rendering["renders_ui"]!!.jsonPrimitive.content.toBoolean())
        // A rendering config MUST carry frequency, or the client has no cap to honour.
        for (k in listOf("is_dismissible", "max_impressions", "cooldown_hours")) {
            assertTrue(rendering.containsKey(k), "rendering config is missing $k")
        }

        val flag = configs[1].jsonObject
        assertEquals("feature_flag", flag["template"]!!.jsonPrimitive.content)
        assertFalse(flag["renders_ui"]!!.jsonPrimitive.content.toBoolean())
        // A non-rendering config MUST NOT carry frequency — asserting absence is the whole
        // point, so a serializer that started emitting them would fail here.
        for (k in listOf("is_dismissible", "max_impressions", "cooldown_hours")) {
            assertFalse(flag.containsKey(k), "feature_flag must not carry $k")
        }
    }

    @Test
    fun inlined_fixture_has_not_drifted_from_the_file() {
        val fromFile = json.parseToJsonElement(locateFixture().readText())
        // Re-parse the inlined copy through the same parser so formatting differences
        // (indentation, key order within an object) do not cause a false failure; a real
        // content change still does.
        val inlined = json.parseToJsonElement(InlinedContractFixture.JSON)
        assertEquals(
            canonical(fromFile as JsonObject),
            canonical(inlined as JsonObject),
            "contract/configs-response.json and the inlined copy in ContractFixtureTest have " +
                "diverged — update the inlined string so the multiplatform test asserts the " +
                "same bytes the server produces",
        )
    }

    /** Stable string form: sorts object keys recursively so only content matters. */
    private fun canonical(e: kotlinx.serialization.json.JsonElement): String = when (e) {
        is JsonObject -> e.entries.sortedBy { it.key }
            .joinToString(",", "{", "}") { "\"${it.key}\":${canonical(it.value)}" }
        is kotlinx.serialization.json.JsonArray -> e.joinToString(",", "[", "]") { canonical(it) }
        else -> e.toString()
    }
}
