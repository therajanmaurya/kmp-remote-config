/*
 * Copyright 2026 MobileByteLabs · Apache 2.0
 */
package com.mobilebytelabs.remoteconfig.dispatch

import com.mobilebytelabs.remoteconfig.model.ActionType
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Covers the action-routing half of cmp-remote-config-compose.
 *
 * `ActionDispatcher` moved here from the core module in the E2 split (2026-09-12) because it is used
 * only by the `Module.remoteConfig { }` DSL and `RemoteConfigHost`, both of which are Compose-bound.
 * It had no test before the move; it is pure logic, so it gets one now rather than riding along
 * untested in a new artifact.
 */
class ActionDispatcherTest {

    @AfterTest
    fun tearDown() {
        // The dispatcher is an object — state leaks between tests unless cleared.
        ActionDispatcher.clear()
    }

    @Test
    fun a_registered_handler_receives_the_value_and_a_context() {
        var seenValue: String? = "untouched"
        var seenContext: ActionContext? = null
        ActionDispatcher.register(
            mapOf(
                ActionType("open_downloads") to
                    ActionHandler { value, context ->
                        seenValue = value
                        seenContext = context
                    },
            ),
        )

        ActionDispatcher.dispatch(ActionType("open_downloads"), "session-42")

        assertEquals("session-42", seenValue)
        assertTrue(seenContext != null, "the handler is handed an ActionContext")
    }

    @Test
    fun register_replaces_rather_than_accumulates() {
        // register() clears first — a second remoteConfig { } block must not leave the first block's
        // handlers wired, or an action would fire into a stale closure.
        var first = 0
        var second = 0
        ActionDispatcher.register(mapOf(ActionType("a") to ActionHandler { _, _ -> first++ }))
        ActionDispatcher.register(mapOf(ActionType("b") to ActionHandler { _, _ -> second++ }))

        ActionDispatcher.dispatch(ActionType("a"), null)
        ActionDispatcher.dispatch(ActionType("b"), null)

        assertEquals(0, first, "the first registration was replaced")
        assertEquals(1, second)
    }

    @Test
    fun an_unregistered_action_type_is_ignored_rather_than_throwing() {
        ActionDispatcher.register(emptyMap())
        // No handler, no exception — a server-driven config naming an action this build does not know
        // must not crash the app.
        ActionDispatcher.dispatch(ActionType("never_registered"), "v")
        ActionDispatcher.dispatch(ActionType.PREMIUM, null)
    }

    @Test
    fun a_handler_registered_for_a_built_in_type_still_wins() {
        // BUILT_IN only suppresses the "no handler" warning; it must not suppress dispatch.
        var fired: String? = null
        ActionDispatcher.register(mapOf(ActionType.PREMIUM to ActionHandler { v, _ -> fired = v ?: "null" }))

        ActionDispatcher.dispatch(ActionType.PREMIUM, "paywall")

        assertEquals("paywall", fired)
        assertNull(null)
    }
}
