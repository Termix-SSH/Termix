import { describe, expect, it } from "vitest";
import { shouldForceLocalPreferenceStorage } from "../../settings/remote-sync-state";

describe("remote sync preference storage state", () => {
  it("does not overwrite cloud mode while desktop sync config is loading", () => {
    expect(shouldForceLocalPreferenceStorage(true, null, "cloud")).toBe(false);
  });

  it("forces local mode only after desktop sync is confirmed unconfigured", () => {
    expect(shouldForceLocalPreferenceStorage(true, false, "cloud")).toBe(true);
    expect(shouldForceLocalPreferenceStorage(true, true, "cloud")).toBe(false);
    expect(shouldForceLocalPreferenceStorage(false, false, "cloud")).toBe(
      false,
    );
  });
});
