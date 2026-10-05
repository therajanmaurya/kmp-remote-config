import { assertEquals } from "jsr:@std/assert@1";
import { type ConfigRow, matchesAudience, sdkCanRender, type TemplateRow, toWireConfig } from "./audience.ts";

const base: ConfigRow = {
  id: "c1",
  template_id: "announcement",
  payload: { title: "t", body: "b" },
  display: "dialog",
  screens: [],
  platforms: [],
  min_app_version: null,
  max_app_version: null,
  priority: 0,
  is_dismissible: true,
  max_impressions: 1,
  cooldown_hours: 24,
  version: 1,
};
const ctx = { platform: "android", appVersion: "4.2.0", sdkVersion: "4.0.0", screen: "home" };

Deno.test("empty screens + empty platforms matches anything", () => {
  assertEquals(matchesAudience(base, ctx), true);
});

Deno.test("screen filter matches only its listed screens", () => {
  assertEquals(matchesAudience({ ...base, screens: ["home"] }, ctx), true);
  assertEquals(matchesAudience({ ...base, screens: ["settings"] }, ctx), false);
});

// Review Focus #1 — an OMITTED screen param matches ONLY untargeted configs. If it matched
// everything, a screen-targeted promo would leak onto every surface; if it matched nothing,
// app-wide announcements would silently stop on an older SDK that sends no screen.
Deno.test("omitted screen matches only configs with no screen targeting", () => {
  const noScreen = { ...ctx, screen: null };
  assertEquals(matchesAudience(base, noScreen), true);
  assertEquals(matchesAudience({ ...base, screens: ["home"] }, noScreen), false);
});

Deno.test("platform filter", () => {
  assertEquals(matchesAudience({ ...base, platforms: ["android"] }, ctx), true);
  assertEquals(matchesAudience({ ...base, platforms: ["ios"] }, ctx), false);
});

Deno.test("version window is inclusive at both ends", () => {
  const c = { ...base, min_app_version: "4.0.0", max_app_version: "4.2.0" };
  assertEquals(matchesAudience(c, ctx), true);
  assertEquals(matchesAudience(c, { ...ctx, appVersion: "3.9.9" }), false);
  assertEquals(matchesAudience(c, { ...ctx, appVersion: "4.2.1" }), false);
});

// Review Focus #2 — a version-targeted config with an UNKNOWN app version must be EXCLUDED,
// or a Play-Store update gate leaks onto desktop and web where no version is reported.
Deno.test("version window FAILS CLOSED when app version is unknown", () => {
  const c = { ...base, min_app_version: "4.0.0" };
  assertEquals(matchesAudience(c, { ...ctx, appVersion: null }), false);
  assertEquals(matchesAudience(c, { ...ctx, appVersion: "" }), false);
  // but a config with NO window still passes with an unknown version
  assertEquals(matchesAudience(base, { ...ctx, appVersion: null }), true);
});

Deno.test("sdkCanRender gates on min_sdk_version and fails closed on unknown", () => {
  const t: TemplateRow = { id: "x", version: 1, renders_ui: true, requires_ack: false, min_sdk_version: "4.1.0" };
  assertEquals(sdkCanRender(t, "4.1.0"), true);
  assertEquals(sdkCanRender(t, "4.2.0"), true);
  assertEquals(sdkCanRender(t, "4.0.9"), false);
  assertEquals(sdkCanRender(t, null), false);
  assertEquals(sdkCanRender(t, ""), false);
});

// Review Focus #4 — feature_flag renders nothing, so frequency fields are meaningless and
// must not appear on the wire even when the row carries them. Emitting caps for a flag
// invites a client to "cap" something that never appears.
Deno.test("non-rendering template omits frequency fields", () => {
  const flagTpl: TemplateRow = { id: "feature_flag", version: 1, renders_ui: false, requires_ack: false, min_sdk_version: "4.0.0" };
  const w = toWireConfig(
    { ...base, template_id: "feature_flag", display: "none", max_impressions: 5, cooldown_hours: 12 },
    flagTpl,
  );
  assertEquals(w.renders_ui, false);
  assertEquals("max_impressions" in w, false);
  assertEquals("cooldown_hours" in w, false);
  assertEquals("is_dismissible" in w, false);
});

Deno.test("rendering template keeps frequency fields", () => {
  const tpl: TemplateRow = { id: "announcement", version: 1, renders_ui: true, requires_ack: false, min_sdk_version: "4.0.0" };
  const w = toWireConfig(base, tpl);
  assertEquals(w.max_impressions, 1);
  assertEquals(w.cooldown_hours, 24);
  assertEquals(w.is_dismissible, true);
});
