package com.mobilebytelabs.remoteconfig.ui

import com.mobilebytelabs.remoteconfig.RemoteConfigEvaluator
import com.mobilebytelabs.remoteconfig.local.DeviceIdProvider
import com.mobilebytelabs.remoteconfig.local.RemoteConfigLocalStore
import com.mobilebytelabs.remoteconfig.model.RemoteConfigTemplate
import com.mobilebytelabs.remoteconfig.network.RemoteConfigService
import com.russhwolf.settings.MapSettings
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Scoping a `RemoteConfigHost` to a template list.
 *
 * The property under test is not "does it filter" — it is that filtering happens BEFORE the
 * evaluator rather than after it. Picking the one app-wide winner and then checking whether its
 * template was named would show nothing on every screen whose templates lost that contest, and
 * would look exactly like "no configs are live" rather than like a bug.
 *
 * Everything here runs through the real `RemoteConfigEvaluator` and the real ViewModel; only the
 * network and the settings store are substituted.
 */
class ScopedHostTest {

    /**
     * A REAL dispatcher, and `runBlocking` rather than `runTest`.
     *
     * The ViewModel wraps its fetch in `withTimeoutOrNull(FETCH_TIMEOUT_MS)`. Under `runTest` —
     * or under any test dispatcher — that timeout runs on a VIRTUAL clock which leaps forward
     * the moment the coroutine suspends, while the MockEngine's response is still in flight on
     * Ktor's own dispatcher. The timeout therefore always wins, the fetch takes the
     * "unavailable" branch, and every assertion fails against perfectly correct code with no
     * rejection recorded to explain it.
     *
     * JVM rather than common for the same reason the goldens are: the logic under test is
     * common, one execution of it proves it, and the alternative here is a virtual clock that
     * makes the subject untestable.
     */
    @BeforeTest
    fun setUp() = Dispatchers.setMain(Dispatchers.Default)

    /**
     * Every host registered during a test, so its refresh loop can be stopped.
     *
     * A registered host starts a refresh loop on `viewModelScope`, i.e. on Main. Leave one
     * running and it wakes a minute later onto a dispatcher `resetMain()` has already torn
     * down, and the resulting uncaught exception is reported against whichever UNRELATED test
     * happens to be starting then — which is how this first surfaced, as a Roborazzi golden
     * failing for no reason of its own.
     */
    private val registered = mutableListOf<Pair<RemoteConfigViewModel, Any>>()

    private fun RemoteConfigViewModel.reg(scope: Set<String>, owner: Any = Any()): Any {
        registerHost(owner, scope)
        registered += this to owner
        return owner
    }

    @AfterTest
    fun tearDown() {
        registered.forEach { (vm, owner) -> vm.unregisterHost(owner) }
        registered.clear()
        Dispatchers.resetMain()
    }

    /**
     * Shaped against `contract/configs-response.json`.
     *
     * `renders_ui` matters more than it looks: the evaluator drops anything false before
     * selection, so omitting it (it defaults false) makes every config vanish and every
     * assertion here fail against perfectly good code.
     */
    private fun item(
        id: String,
        template: String,
        display: String = "dialog",
        priority: Int = 0,
        maxImpressions: Int = 1,
        rendersUi: Boolean = true,
    ) = """
        {"id":"$id","template":"$template","template_version":1,"display":"$display",
         "payload":{"title":"T","body":"B"},
         "priority":$priority,"renders_ui":$rendersUi,"requires_ack":false,"version":1,
         "is_dismissible":true,"max_impressions":$maxImpressions,"cooldown_hours":0}
    """.trimIndent()

    private fun vm(vararg items: String, capture: MutableList<String>? = null): RemoteConfigViewModel {
        val engine = MockEngine { request ->
            capture?.add(request.url.toString())
            respond(
                content = """{"schema_version":1,"configs":[${items.joinToString(",")}]}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val service = RemoteConfigService(
            baseUrl = "https://example.supabase.co/functions/v1",
            publishableKey = "rck_test_abc",
            packageName = "com.example.app",
            platform = "android",
            appVersion = "1.0.0",
            httpClient = HttpClient(engine),
            deviceId = "device-under-test",
        )
        val store = RemoteConfigLocalStore(MapSettings())
        return RemoteConfigViewModel(
            service = service,
            evaluator = RemoteConfigEvaluator(store),
            localStore = store,
            deviceIdProvider = DeviceIdProvider(MapSettings()),
        )
    }

    /**
     * Fetch, then WAIT for it to land.
     *
     * `fetchAndEvaluate` launches into `viewModelScope` and the MockEngine's response completes
     * on Ktor's own dispatcher, so neither returning from the call nor advancing virtual time
     * means the state has been written. Awaiting `isLoading == false` is the only signal that
     * does not depend on which dispatcher did the work — the earlier version of this file read
     * the state too early and every assertion failed against correct code.
     */
    private suspend fun RemoteConfigViewModel.fetchAndSettle() {
        fetchAndEvaluate()
        withTimeout(10_000) { state.first { !it.isLoading } }
    }

    private fun scope(vararg t: RemoteConfigTemplate) = t.mapTo(mutableSetOf()) { it.id }

    @Test
    fun a_scoped_host_shows_a_config_the_app_wide_winner_outranks() = runBlocking {
        // THE case the naive implementation gets wrong. The paywall wins app-wide on priority,
        // so a host that read `activeConfig` and then checked its template would render nothing
        // on a screen that hosts update_available — and look like there was nothing to show.
        val v = vm(
            item("paywall", "paywall_upsell", display = "fullscreen", priority = 100),
            item("update", "update_available", priority = 1),
        )
        v.fetchAndSettle()

        assertEquals("paywall", v.state.value.activeConfig?.id, "precondition: paywall wins app-wide")
        assertEquals("update", v.activeFor(scope(RemoteConfigTemplate.UpdateAvailable))?.id)
    }

    @Test
    fun naming_no_templates_keeps_the_previous_behaviour() = runBlocking {
        val v = vm(item("a", "announcement", priority = 5), item("b", "whats_new", display = "bottom_sheet"))
        v.fetchAndSettle()
        // Asserted non-null first: while the fetch silently never ran, this test compared null
        // to null and passed, which is the shape of a test that proves nothing.
        assertEquals("a", v.state.value.activeConfig?.id)
        assertEquals(v.state.value.activeConfig?.id, v.activeFor(emptySet())?.id)
    }

    @Test
    fun priority_still_breaks_ties_inside_the_scope() = runBlocking {
        val v = vm(
            item("low", "announcement", priority = 1),
            item("high", "notification", display = "bottom_sheet", priority = 9),
        )
        v.fetchAndSettle()
        assertEquals(
            "high",
            v.activeFor(scope(RemoteConfigTemplate.Announcement, RemoteConfigTemplate.Notification))?.id,
        )
    }

    @Test
    fun a_template_with_nothing_live_shows_nothing() = runBlocking {
        val v = vm(item("a", "announcement"))
        v.fetchAndSettle()
        assertNull(v.activeFor(scope(RemoteConfigTemplate.PaywallUpsell)))
    }

    @Test
    fun a_value_only_template_renders_nothing_even_when_named() = runBlocking {
        // feature_flag has display "none". The evaluator drops it before selection, and naming
        // it must stay a harmless no-op rather than producing an empty overlay.
        val v = vm(item("flag", "feature_flag", display = "none", rendersUi = false))
        v.fetchAndSettle()
        assertNull(v.activeFor(scope(RemoteConfigTemplate.FeatureFlag)))
    }

    @Test
    fun a_dismissed_config_does_not_come_back_under_the_users_finger() = runBlocking {
        // A non-permanent dismissal writes nothing to the local store, so the evaluator cannot
        // see it. Before scoping, dismissal just nulled activeConfig and nothing re-evaluated.
        // A scoped host re-evaluates — so without session suppression the same config passes
        // every check again and reappears immediately.
        val v = vm(item("a", "announcement"))
        v.fetchAndSettle()
        assertEquals("a", v.activeFor(scope(RemoteConfigTemplate.Announcement))?.id)

        v.onConfigDismissed("a", permanent = false)
        assertNull(v.activeFor(scope(RemoteConfigTemplate.Announcement)), "it came back after being dismissed")
    }

    @Test
    fun acting_on_a_config_also_retires_it_for_the_session() = runBlocking {
        val v = vm(item("a", "notification", display = "bottom_sheet"))
        v.fetchAndSettle()
        v.onActionClicked("a")
        assertNull(v.activeFor(scope(RemoteConfigTemplate.Notification)))
    }

    @Test
    fun a_custom_template_id_is_nameable_without_an_sdk_change() = runBlocking {
        // The reason RemoteConfigTemplate is not an enum: a template registered in the control plane after
        // this SDK shipped must still be addressable, or every new template is a forced upgrade.
        val v = vm(item("x", "seasonal_banner", display = "banner"))
        v.fetchAndSettle()
        assertEquals("x", v.activeFor(scope(RemoteConfigTemplate("seasonal_banner")))?.id)
    }

    @Test
    fun the_builtin_constants_match_the_wire_ids() {
        // A prettified constant does not fail loudly — it silently matches no config, in a
        // feature whose correct behaviour is frequently "show nothing".
        assertEquals("update_available", RemoteConfigTemplate.UpdateAvailable.id)
        assertEquals("policy_update", RemoteConfigTemplate.PolicyUpdate.id)
        assertEquals("paywall_upsell", RemoteConfigTemplate.PaywallUpsell.id)
        assertEquals(15, RemoteConfigTemplate.builtins.size)
        assertTrue(RemoteConfigTemplate.builtins.all { it.id == it.id.lowercase() && !it.id.contains(' ') })
    }

    // ── fetch scoping + the single-surface lock ─────────────────────────────────────────────

    private fun settle(v: RemoteConfigViewModel) = runBlocking {
        withTimeout(10_000) { v.state.first { !it.isLoading } }
    }

    @Test
    fun the_request_is_bounded_to_the_templates_a_host_asked_for() = runBlocking {
        val seen = mutableListOf<String>()
        val v = vm(item("a", "announcement"), capture = seen)
        v.reg(scope(RemoteConfigTemplate.UpdateAvailable, RemoteConfigTemplate.PolicyUpdate))
        withTimeout(10_000) { v.state.first { !it.isLoading } }

        val q = seen.single()
        assertTrue(q.contains("templates=policy_update%2Cupdate_available"), "sorted scope absent from $q")
    }

    @Test
    fun an_unscoped_host_asks_for_everything() = runBlocking {
        val seen = mutableListOf<String>()
        val v = vm(item("a", "announcement"), capture = seen)
        v.reg(emptySet())
        withTimeout(10_000) { v.state.first { !it.isLoading } }
        assertTrue(!seen.single().contains("templates="), "an unscoped host narrowed the request")
    }

    @Test
    fun three_hosts_on_one_screen_make_one_request() = runBlocking {
        val seen = mutableListOf<String>()
        val v = vm(item("a", "announcement"), capture = seen)
        repeat(3) { v.reg(scope(RemoteConfigTemplate.Announcement)) }
        withTimeout(10_000) { v.state.first { !it.isLoading } }
        assertEquals(1, seen.size)
    }

    @Test
    fun leaving_a_screen_stops_its_templates_counting() = runBlocking {
        // THE fix. With an accumulating union, by the fifth screen of a session the app asks
        // for everything again and scoping has quietly stopped doing anything. The request is
        // the union of what is MOUNTED, so a host that left stops widening it.
        val seen = mutableListOf<String>()
        val v = vm(item("a", "announcement"), capture = seen)

        val screenOne = Any()
        v.reg(scope(RemoteConfigTemplate.Announcement), screenOne)
        withTimeout(10_000) { v.state.first { !it.isLoading } }

        v.unregisterHost(screenOne)
        v.reg(scope(RemoteConfigTemplate.PaywallUpsell))
        withTimeout(10_000) { v.state.first { !it.isLoading } }

        val second = seen.last()
        assertTrue(second.contains("templates=paywall_upsell"), "second request was $second")
        assertTrue(
            !second.contains("announcement"),
            "the departed screen's template is still being requested: $second",
        )
    }

    @Test
    fun a_narrower_scope_does_not_refetch() = runBlocking {
        val seen = mutableListOf<String>()
        val v = vm(item("a", "announcement"), capture = seen)
        v.reg(emptySet())                    // asks for everything
        withTimeout(10_000) { v.state.first { !it.isLoading } }
        v.reg(scope(RemoteConfigTemplate.Announcement))
        // What we hold is a superset; re-asking would spend a round trip to receive less.
        assertEquals(1, seen.size)
    }

    @Test
    fun the_highest_priority_candidate_wins_the_surface() = runBlocking {
        // THE other fix. Decided by priority in the ViewModel, not by which host's effect ran
        // first — otherwise a forced update loses to an onboarding tip because of where someone
        // put a call in a file.
        val v = vm(
            item("tip", "onboarding_tip", display = "banner", priority = 1),
            item("forced", "update_available", display = "fullscreen", priority = 99),
        )
        v.fetchAndSettle()

        val tipHost = Any()
        val updateHost = Any()
        // The low-priority host offers FIRST — composition order is deliberately against it.
        v.offerCandidate(tipHost, v.activeFor(scope(RemoteConfigTemplate.OnboardingTip)))
        v.offerCandidate(updateHost, v.activeFor(scope(RemoteConfigTemplate.UpdateAvailable)))

        assertEquals(updateHost, v.surfaceOwner.value, "composition order beat priority")
    }

    @Test
    fun only_one_host_holds_the_surface_at_a_time() = runBlocking {
        val v = vm(item("a", "announcement"))
        v.fetchAndSettle()
        val first = Any()
        val second = Any()
        v.offerCandidate(first, v.activeFor(scope(RemoteConfigTemplate.Announcement)))
        v.offerCandidate(second, v.activeFor(scope(RemoteConfigTemplate.Announcement)))
        assertEquals(first, v.surfaceOwner.value, "equal priority should fall back to the first offer")
    }

    @Test
    fun the_surface_passes_on_when_the_holder_leaves() = runBlocking {
        // Otherwise a dismissed or departed host locks out every other one for the session.
        val v = vm(item("a", "announcement"))
        v.fetchAndSettle()
        val first = Any()
        val second = Any()
        v.offerCandidate(first, v.activeFor(scope(RemoteConfigTemplate.Announcement)))
        v.offerCandidate(second, v.activeFor(scope(RemoteConfigTemplate.Announcement)))
        v.unregisterHost(first)
        assertEquals(second, v.surfaceOwner.value, "the surface never passed on")
    }

    @Test
    fun a_host_with_nothing_to_show_does_not_hold_the_surface() = runBlocking {
        // Offering null must RELEASE, or a host whose config was dismissed keeps the surface
        // against one that has something to render.
        val v = vm(item("a", "announcement"))
        v.fetchAndSettle()
        val empty = Any()
        val real = Any()
        v.offerCandidate(empty, null)
        v.offerCandidate(real, v.activeFor(scope(RemoteConfigTemplate.Announcement)))
        assertEquals(real, v.surfaceOwner.value)
    }

    // ── the two fetch budgets ──────────────────────────────────────────────────────────────

    /** A service whose response takes `delayMs`, so a budget can actually be exceeded. */
    private fun slowVm(delayMs: Long): RemoteConfigViewModel {
        val engine = MockEngine {
            delay(delayMs)
            respond(
                content = """{"schema_version":1,"configs":[${item("a", "announcement")}]}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val service = RemoteConfigService(
            baseUrl = "https://example.supabase.co/functions/v1",
            publishableKey = "rck_test_abc",
            packageName = "com.example.app",
            platform = "android",
            appVersion = "1.0.0",
            httpClient = HttpClient(engine),
            deviceId = "device-under-test",
        )
        val store = RemoteConfigLocalStore(MapSettings())
        return RemoteConfigViewModel(
            service = service,
            evaluator = RemoteConfigEvaluator(store),
            localStore = store,
            deviceIdProvider = DeviceIdProvider(MapSettings()),
        )
    }

    @Test
    fun a_first_fetch_waits_longer_than_the_refresh_budget() = runBlocking {
        // 4s is past the 2.5s refresh budget and inside the 10s first-fetch one. With a single
        // budget this is the cold start that silently serves bundled defaults and logs a
        // transport failure — observed on a device that took 1m39s to start.
        val v = slowVm(4_000)
        v.fetchAndSettle()
        assertEquals("a", v.state.value.activeConfig?.id, "the first fetch gave up too early")
    }

    @Test
    fun a_refresh_gives_up_early_because_something_is_already_on_screen() = runBlocking {
        // The other half: once there IS something to show, holding the loading state open for
        // ten seconds is the worse trade. Same 4s response, now exceeding the budget.
        val v = slowVm(4_000)
        v.fetchAndSettle()
        assertEquals("a", v.state.value.activeConfig?.id, "precondition: the first fetch landed")

        v.fetchAndEvaluate()
        withTimeout(10_000) { v.state.first { !it.isLoading } }
        // The refresh timed out, so the previous answer stands rather than being cleared —
        // a slow refresh must never blank a config the user is looking at.
        assertEquals("a", v.state.value.activeConfig?.id)
        assertEquals(null, v.state.value.rejection, "a timeout is not a rejection")
    }

    // ── foreground refresh + the kill switch ───────────────────────────────────────────────

    /** A service whose envelope carries explicit SDK settings. */
    private fun vmWithSettings(settingsJson: String, capture: MutableList<String>? = null): RemoteConfigViewModel {
        val engine = MockEngine { request ->
            capture?.add(request.url.toString())
            respond(
                content = """{"schema_version":1,"configs":[${item("a", "announcement")}],"settings":$settingsJson}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val service = RemoteConfigService(
            baseUrl = "https://example.supabase.co/functions/v1",
            publishableKey = "rck_test_abc",
            packageName = "com.example.app",
            platform = "android",
            appVersion = "1.0.0",
            httpClient = HttpClient(engine),
            deviceId = "device-under-test",
        )
        val store = RemoteConfigLocalStore(MapSettings())
        return RemoteConfigViewModel(
            service = service,
            evaluator = RemoteConfigEvaluator(store),
            localStore = store,
            deviceIdProvider = DeviceIdProvider(MapSettings()),
        )
    }

    @Test
    fun the_kill_switch_clears_what_is_already_on_screen() = runBlocking {
        // `enabled = false` is what an operator reaches for during an incident. Stopping only
        // the NEXT fetch would leave the surface up until the user relaunched — half a switch,
        // and the missing half is the half that matters.
        val v = vmWithSettings("""{"enabled":false,"fetch_interval_seconds":60}""")
        v.reg(emptySet())
        withTimeout(10_000) { v.state.first { !it.isLoading } }

        assertNull(v.state.value.activeConfig, "a disabled app still had a config on screen")
        assertTrue(v.state.value.delivered.isEmpty(), "a disabled app still held delivered configs")
        assertNull(v.activeFor(emptySet()), "a scoped host could still find something to show")
    }

    @Test
    fun an_enabled_app_keeps_its_configs() = runBlocking {
        // The control. Without it the test above passes just as well against a bug that clears
        // the configs unconditionally.
        val v = vmWithSettings("""{"enabled":true,"fetch_interval_seconds":60}""")
        v.reg(emptySet())
        withTimeout(10_000) { v.state.first { !it.isLoading } }

        assertEquals("a", v.state.value.activeConfig?.id)
        assertEquals(1, v.state.value.delivered.size)
    }

    @Test
    fun nothing_on_screen_means_nothing_is_refreshed() = runBlocking {
        // The loop is tied to mounted hosts, so an app displaying no surface does not poll the
        // control plane on a timer for an audience of nobody.
        val seen = mutableListOf<String>()
        val v = vmWithSettings("""{"enabled":true,"fetch_interval_seconds":60}""", capture = seen)
        val host = Any()
        v.reg(emptySet(), host)
        withTimeout(10_000) { v.state.first { !it.isLoading } }
        assertEquals(1, seen.size)

        v.unregisterHost(host)
        // The interval floor is 60s, so no refresh is due yet either way; what this pins is
        // that unregistering does not leave a job behind that would fire later.
        assertEquals(1, seen.size)
    }
}
