/**
 * The only client this module needs: an HTTPS caller holding an access token and nothing else.
 *
 * No Supabase key of any kind — not service-role, not even anon. `v1-admin` authenticates the
 * bearer token and forwards it to `api.rconfig_api`, which decides everything. That is what
 * finally removes the laptop-holds-a-service-key problem rather than relocating it.
 */
export function createApiClient(functionsUrl, token) {
    return {
        async call(op, args) {
            let res;
            try {
                res = await fetch(`${functionsUrl.replace(/\/$/, "")}/v1-admin`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ op, args }),
                });
            }
            catch (e) {
                // A network failure is NOT a refusal. Saying "not permitted" here would send someone to
                // regenerate a token that was fine.
                return { error: `could not reach the control plane: ${e.message}` };
            }
            let body;
            try {
                body = await res.json();
            }
            catch {
                return { error: `the control plane returned ${res.status} with no JSON body` };
            }
            return body;
        },
    };
}
/**
 * The single call this module makes.
 *
 * A transport failure is reported as such rather than as a refusal: "could not reach the
 * control plane" sends someone to check the network, where "not permitted" sends them to
 * regenerate a token that was fine.
 */
async function call(db, _token, op, args = {}) {
    // The token is held by the client, not threaded per call — it is a property of the connection,
    // the same way a session is. The parameter stays in each signature so the call sites read as
    // authenticated operations rather than anonymous ones.
    const envelope = await db.call(op, args);
    if (envelope.error)
        return { error: envelope.error };
    return envelope.data;
}
export const listApps = (db, token) => call(db, token, "list_apps");
export const listParameters = (db, token, appId) => call(db, token, "list_parameters", { app_id: appId });
export const listConditions = (db, token, appId) => call(db, token, "list_conditions", { app_id: appId });
export const listVersions = (db, token, appId) => call(db, token, "list_versions", { app_id: appId });
export const previewForDevice = (db, token, appId, audience) => call(db, token, "preview_for_device", { app_id: appId, audience });
export const explainParameter = (db, token, parameterId, audience) => call(db, token, "explain_parameter", { parameter_id: parameterId, audience });
export const onboardApp = (db, token, input) => call(db, token, "onboard_app", { ...input });
/**
 * Add a platform key to an app that already exists.
 *
 * `onboardApp` mints keys only while CREATING an app and refuses a slug it has seen before, so
 * an app registered for Android and later shipped on iOS had no path to an iOS key — and could
 * not reuse the Android one, because `app_key.platform` is enforced rather than advisory
 * (`_shared/identity.ts` answers a mismatch with 403 `platform_mismatch`).
 *
 * Same envelope as onboarding, so a caller that already renders onboarding's keys renders these.
 */
export const issueKey = (db, token, input) => call(db, token, "issue_key", { ...input });
export const createParameter = (db, token, appId, p) => call(db, token, "create_parameter", { app_id: appId, ...p });
export const createCondition = (db, token, appId, c) => call(db, token, "create_condition", { app_id: appId, ...c });
/**
 * Note there is no `app_id` here: this names a PARAMETER, and the funnel resolves the owning
 * app to scope-check it. That absence was a hole until migration 017 — the generic scope check
 * keys on `app_id`, so the one write that changes what a targeted audience receives was
 * skipping it entirely.
 */
export const addOverride = (db, token, o) => call(db, token, "add_override", { ...o });
export const publish = (db, token, appId) => call(db, token, "publish", { app_id: appId });
export const rollback = (db, token, appId, version) => call(db, token, "rollback", { app_id: appId, version });
