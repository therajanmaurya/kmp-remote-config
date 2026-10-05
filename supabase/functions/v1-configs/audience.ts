export interface ConfigRow {
  id: string;
  template_id: string;
  payload: unknown;
  display: string;
  screens: string[];
  platforms: string[];
  min_app_version: string | null;
  max_app_version: string | null;
  priority: number;
  is_dismissible: boolean;
  max_impressions: number;
  cooldown_hours: number;
  version: number;
}

export interface TemplateRow {
  id: string;
  version: number;
  renders_ui: boolean;
  requires_ack: boolean;
  min_sdk_version: string;
}

export interface AudienceContext {
  platform: string | null;
  appVersion: string | null;
  sdkVersion: string | null;
  screen: string | null;
}

/** Numeric-segment compare. Returns <0, 0, >0. Missing segments count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * AUDIENCE only — platform, screen, version window. Schedule and is_enabled are filtered
 * in SQL; per-device frequency (impression cap, cooldown, dismissed) stays on the client
 * because that is device-local state and must work offline.
 */
export function matchesAudience(c: ConfigRow, ctx: AudienceContext): boolean {
  // An omitted `screen` matches ONLY untargeted configs: an untargeted caller gets
  // untargeted configs. Matching everything would leak a screen-targeted promo onto every
  // surface; matching nothing would silently stop app-wide announcements on an older SDK.
  if (c.screens.length > 0) {
    if (!ctx.screen || !c.screens.includes(ctx.screen)) return false;
  }
  if (c.platforms.length > 0) {
    if (!ctx.platform || !c.platforms.includes(ctx.platform)) return false;
  }
  const min = c.min_app_version?.trim() || null;
  const max = c.max_app_version?.trim() || null;
  if (min || max) {
    // FAIL CLOSED on an unknown app version: a version-TARGETED config must never show
    // where we cannot confirm the device is inside the window, or a Play-Store update
    // gate leaks onto desktop and web.
    const v = ctx.appVersion?.trim();
    if (!v) return false;
    if (min && compareVersions(v, min) < 0) return false;
    if (max && compareVersions(v, max) > 0) return false;
  }
  return true;
}

/**
 * True when this build's SDK can render the template. Unknown SDK version fails closed —
 * the same reasoning as the version window: without knowing what the client can do, the
 * safe answer is to send nothing rather than a shape it may blank the screen on.
 */
export function sdkCanRender(t: TemplateRow, sdkVersion: string | null): boolean {
  const v = sdkVersion?.trim();
  if (!v) return false;
  return compareVersions(v, t.min_sdk_version) >= 0;
}

export interface WireConfig {
  id: string;
  template: string;
  template_version: number;
  display: string;
  payload: unknown;
  priority: number;
  renders_ui: boolean;
  requires_ack: boolean;
  version: number;
  is_dismissible?: boolean;
  max_impressions?: number;
  cooldown_hours?: number;
}

export function toWireConfig(c: ConfigRow, t: TemplateRow): WireConfig {
  const w: WireConfig = {
    id: c.id,
    template: t.id,
    template_version: t.version,
    display: c.display,
    payload: c.payload,
    priority: c.priority,
    renders_ui: t.renders_ui,
    requires_ack: t.requires_ack,
    version: c.version,
  };
  // Frequency only means something for a config that renders. Emitting caps for a feature
  // flag invites a client to "cap" something that never appears.
  if (t.renders_ui) {
    w.is_dismissible = c.is_dismissible;
    w.max_impressions = c.max_impressions;
    w.cooldown_hours = c.cooldown_hours;
  }
  return w;
}
