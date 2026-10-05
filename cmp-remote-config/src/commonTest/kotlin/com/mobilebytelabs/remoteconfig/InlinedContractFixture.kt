package com.mobilebytelabs.remoteconfig

/**
 * The `/v1/configs` response fixture, inlined.
 *
 * `commonTest` has no filesystem on js/wasmJs/native, so the multiplatform contract test
 * cannot read `contract/configs-response.json` directly. It asserts this copy instead, and
 * `ContractFixtureFileTest` (jvmTest) proves this copy has not drifted from the real file —
 * without that second test, this string could silently go stale.
 *
 * Keep it byte-equivalent in CONTENT to contract/configs-response.json. Formatting is free;
 * the drift check canonicalises before comparing.
 */
internal object InlinedContractFixture {
    const val JSON: String = """
        {"schema_version":1,"configs":[
          {"id":"0f9b7c1e-2a3d-4b5c-8d7e-1f2a3b4c5d6e","template":"update_available",
           "template_version":1,"display":"dialog",
           "payload":{"store_url":"https://play.google.com/store/apps/details?id=com.example.app","forced":false},
           "priority":10,"renders_ui":true,"requires_ack":false,"version":1,
           "is_dismissible":true,"max_impressions":1,"cooldown_hours":24},
          {"id":"1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9","template":"feature_flag",
           "template_version":1,"display":"none",
           "payload":{"key":"new_search","value":true},
           "priority":0,"renders_ui":false,"requires_ack":false,"version":1}
        ]}
    """
}
