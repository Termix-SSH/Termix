import { describe, expect, it } from "vitest";
import { selectExportableSettings } from "../../utils/export-settings.js";

const rows = [
  { key: "allow_registration", value: "true" },
  { key: "audit_log_forward_token", value: "secret" },
  { key: "reset_code_alice", value: "123456" },
  { key: "temp_reset_token_alice", value: "abc" },
  { key: "user_dek_v3_u1", value: "{}" },
];

describe("selectExportableSettings", () => {
  it("gives a non-admin export no global settings", () => {
    expect(selectExportableSettings(rows, false)).toEqual([]);
  });

  it("keeps instance config for admins but drops secrets", () => {
    expect(selectExportableSettings(rows, true).map((r) => r.key)).toEqual([
      "allow_registration",
      "user_dek_v3_u1",
    ]);
  });
});
