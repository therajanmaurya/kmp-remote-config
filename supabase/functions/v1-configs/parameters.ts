import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Resolve this caller's parameter values.
 *
 * A thin call into `resolve_parameters`, deliberately. The matching rules — platform, screen,
 * semver window — already exist in SQL for conditions, and re-implementing them here would
 * give the product two definitions of what "Android beta" means. They would agree in review
 * and drift in production, and the first symptom would be a user seeing the wrong value.
 *
 * Returns {} rather than throwing when anything goes wrong. A parameter lookup failing must
 * not take down the configs response beside it: a dark banner is a worse outcome than a
 * parameter falling back to its in-app default, which is exactly what the SDK does with an
 * absent key.
 */
export async function resolveParameters(
  db: SupabaseClient,
  appId: string,
  audience: { platform?: string | null; screen?: string | null; app_version?: string | null },
): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("resolve_parameters", {
    p_app: appId,
    p_audience: {
      platform: audience.platform ?? null,
      screen: audience.screen ?? null,
      app_version: audience.app_version ?? null,
    },
  });
  if (error || data == null) return {};
  return data as Record<string, unknown>;
}
