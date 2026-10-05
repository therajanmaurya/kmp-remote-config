package com.mobilebytelabs.remoteconfig.dispatch

/**
 * Context passed to [ActionHandler]s when an action fires.
 *
 * Currently empty — extension point for future enrichment (NavController, SnackbarHostState,
 * app coroutine scope, etc.). Handlers reach for app-level singletons until this evolves.
 *
 * The constructor is public as of the E2 split (2026-09-12): this type is the parameter of the public
 * [ActionHandler] interface, and `ActionDispatcher` — which constructs it — now lives in
 * cmp-remote-config-compose, where `internal` is not visible. Additive (a constructor is added, none
 * removed), and it lets a consumer construct one to unit-test their own handler.
 */
class ActionContext public constructor()
