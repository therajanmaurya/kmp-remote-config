package com.mobilebytelabs.remoteconfig.dispatch

import com.mobilebytelabs.remoteconfig.model.RemoteConfigItem

/**
 * Context passed to [ActionHandler]s when an action fires.
 *
 * Carries the config that fired the action.
 *
 * It was empty, which meant a handler received a bare string and had no way to know WHICH config
 * triggered it — not its template, not its id, not the rest of its payload. An app wanting to log
 * "which announcement did they tap" had to infer it from the value, and a built-in action needing
 * another payload field could not reach one at all. `update_available` is the case that forced
 * this: whether an update is `forced` decides between an immediate and a flexible update flow,
 * and that flag lives in the payload beside the URL, not in the value.
 *
 * Nullable because an action can be dispatched without one — a consumer unit-testing their own
 * handler, or a call site that has no config in hand.
 *
 * The constructor is public as of the E2 split (2026-09-12): this type is the parameter of the public
 * [ActionHandler] interface, and `ActionDispatcher` — which constructs it — now lives in
 * cmp-remote-config-compose, where `internal` is not visible. Additive (a constructor is added, none
 * removed), and it lets a consumer construct one to unit-test their own handler.
 */
class ActionContext public constructor(
    public val config: RemoteConfigItem? = null,
)
