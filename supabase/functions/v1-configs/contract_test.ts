import { assertEquals } from "jsr:@std/assert@1";
import { type ConfigRow, type TemplateRow, toWireConfig } from "./audience.ts";

// The twin of cmp-remote-config/src/commonTest/.../ContractFixtureTest.kt. Both assert
// contract/configs-response.json. This pair is the entire reason the SDK, the backend and
// the dashboard share one repo: a commit that changes the response shape without changing
// the Kotlin model fails CI.
const fixture = JSON.parse(
  await Deno.readTextFile(new URL("../../../contract/configs-response.json", import.meta.url)),
);

const renderingRow: ConfigRow = {
  id: "0f9b7c1e-2a3d-4b5c-8d7e-1f2a3b4c5d6e",
  template_id: "update_available",
  payload: {
    store_url: "https://play.google.com/store/apps/details?id=com.example.app",
    forced: false,
  },
  display: "dialog",
  screens: [],
  platforms: [],
  min_app_version: null,
  max_app_version: null,
  priority: 10,
  is_dismissible: true,
  max_impressions: 1,
  cooldown_hours: 24,
  version: 1,
};
const renderingTpl: TemplateRow = {
  id: "update_available",
  version: 1,
  renders_ui: true,
  requires_ack: false,
  min_sdk_version: "4.0.0",
};

const flagRow: ConfigRow = {
  id: "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9",
  template_id: "feature_flag",
  payload: { key: "new_search", value: true },
  display: "none",
  screens: [],
  platforms: [],
  min_app_version: null,
  max_app_version: null,
  priority: 0,
  // Deliberately non-default: the serializer must DROP these for a non-rendering template,
  // so a fixture that contained them would prove the opposite of what we want.
  is_dismissible: true,
  max_impressions: 5,
  cooldown_hours: 12,
  version: 1,
};
const flagTpl: TemplateRow = {
  id: "feature_flag",
  version: 1,
  renders_ui: false,
  requires_ack: false,
  min_sdk_version: "4.0.0",
};

Deno.test("the route's own serializer reproduces the fixture exactly", () => {
  assertEquals(toWireConfig(renderingRow, renderingTpl), fixture.configs[0]);
  assertEquals(toWireConfig(flagRow, flagTpl), fixture.configs[1]);
});

Deno.test("fixture declares the schema version the Kotlin model expects", () => {
  assertEquals(fixture.schema_version, 1);
  assertEquals(fixture.configs.length, 2);
});
