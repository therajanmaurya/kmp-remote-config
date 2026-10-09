package com.mobilebytelabs.remoteconfig.ui.templates

import com.mobilebytelabs.remoteconfig.model.ActionType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * `cta_action` carries both the intent and the destination, and the template bodies were passing
 * the whole string as BOTH — so `url:https://example.com/pricing` arrived at the dispatcher as an
 * action TYPE of `"url:https://example.com/pricing"`, matched no handler, and did nothing.
 *
 * That made every CTA on `announcement`, `notification`, `paywall_upsell` and `promo_offer`
 * unreachable independently of the dispatcher, which is the part worth pinning: the dispatcher
 * tests all pass, and all four templates were still dead.
 */
class CtaActionTest {

    @Test
    fun a_typed_url_splits_into_type_and_destination() {
        val a = parseCtaAction("url:https://example.com/pricing")
        assertEquals(ActionType.URL, a.type)
        assertEquals("https://example.com/pricing", a.value)
    }

    @Test
    fun the_destination_keeps_its_own_colons() {
        // `https://` contains the delimiter. Splitting on the LAST colon, or on every colon,
        // would truncate the URL to `https` — which is why this splits once, at the first.
        assertEquals("https://x.test:8443/a:b?q=1", parseCtaAction("url:https://x.test:8443/a:b?q=1").value)
    }

    @Test
    fun a_typed_store_and_deeplink_split_the_same_way() {
        assertEquals(ActionType.STORE, parseCtaAction("store:market://details?id=x").type)
        assertEquals("market://details?id=x", parseCtaAction("store:market://details?id=x").value)
        assertEquals(ActionType.DEEPLINK, parseCtaAction("deeplink:myapp://settings").type)
        assertEquals("myapp://settings", parseCtaAction("deeplink:myapp://settings").value)
    }

    @Test
    fun a_bare_type_word_carries_no_destination() {
        assertEquals(ActionType.DISMISS, parseCtaAction("dismiss").type)
        assertNull(parseCtaAction("dismiss").value)
        assertEquals(ActionType.ACKNOWLEDGE, parseCtaAction("acknowledge").type)
        assertEquals(ActionType.PREMIUM, parseCtaAction("premium").type)
    }

    @Test
    fun a_bare_https_url_is_treated_as_a_url() {
        // An operator typing a link into a field labelled "action" is the obvious thing to do.
        val a = parseCtaAction("https://example.com/whats-new")
        assertEquals(ActionType.URL, a.type)
        assertEquals("https://example.com/whats-new", a.value)
    }

    @Test
    fun a_bare_custom_scheme_is_treated_as_a_deeplink() {
        // Must NOT parse as type `myapp` + value `//settings`, which is what a naive split on the
        // first colon produces and what would make every custom-scheme CTA dead.
        val a = parseCtaAction("myapp://settings/backup")
        assertEquals(ActionType.DEEPLINK, a.type)
        assertEquals("myapp://settings/backup", a.value)
    }

    @Test
    fun an_unknown_bare_word_becomes_a_custom_type_a_host_can_claim() {
        val a = parseCtaAction("redeem_offer")
        assertEquals(ActionType("redeem_offer"), a.type)
        assertNull(a.value, "a custom type has no destination the SDK could open")
    }

    @Test
    fun null_and_blank_fall_back_to_the_callers_default() {
        // Each template has its own sensible default: a policy CTA without an action is an
        // acknowledgement, an announcement's is a dismiss.
        assertEquals(ActionType.DISMISS, parseCtaAction(null).type)
        assertEquals(ActionType.DISMISS, parseCtaAction("   ").type)
        assertEquals(ActionType.URL, parseCtaAction(null, fallback = ActionType.URL).type)
    }

    @Test
    fun a_typed_prefix_with_nothing_after_it_has_a_null_destination() {
        // `url:` saved by an operator who cleared the field. Handing "" to a launcher is an error
        // dialog on some targets; null is what the dispatcher already drops.
        assertNull(parseCtaAction("url:").value)
        assertNull(parseCtaAction("url:   ").value)
        assertEquals(ActionType.URL, parseCtaAction("url:").type)
    }

    @Test
    fun the_type_prefix_is_case_insensitive_and_tolerates_padding() {
        // Operator-typed values arrive with stray capitals and spaces.
        assertEquals(ActionType.URL, parseCtaAction("URL:https://x.test").type)
        assertEquals("https://x.test", parseCtaAction("  Url: https://x.test  ").value)
    }
}
