import { afterEach, describe, expect, it } from "vitest";
import {
  forgetCachedSetting,
  isSettingsCachePrimed,
  primeSettingsCache,
  readCachedSetting,
  resetSettingsCache,
  updateCachedSetting,
} from "../../../database/repositories/settings-cache.js";

afterEach(() => resetSettingsCache());

describe("settings cache", () => {
  it("starts unprimed", () => {
    expect(isSettingsCachePrimed()).toBe(false);
  });

  it("reads back what was primed", () => {
    primeSettingsCache([
      { key: "guac_url", value: "guacd:4822" },
      { key: "allow_registration", value: "false" },
    ]);

    expect(isSettingsCachePrimed()).toBe(true);
    expect(readCachedSetting("guac_url")).toBe("guacd:4822");
    expect(readCachedSetting("allow_registration")).toBe("false");
  });

  it("returns null for a key that is not set", () => {
    primeSettingsCache([{ key: "guac_url", value: "guacd:4822" }]);

    expect(readCachedSetting("missing")).toBeNull();
  });

  it("returns null rather than throwing before priming", () => {
    // Startup ordering means a read can land first. Every caller already
    // treats null as "use the default", so this must not throw.
    expect(readCachedSetting("guac_url")).toBeNull();
  });

  it("reflects a write immediately", () => {
    primeSettingsCache([{ key: "log_level", value: "info" }]);

    updateCachedSetting("log_level", "debug");

    // A synchronous reader must not see the pre-write value.
    expect(readCachedSetting("log_level")).toBe("debug");
  });

  it("accepts a key that did not exist at prime time", () => {
    primeSettingsCache([]);

    updateCachedSetting("new_key", "value");

    expect(readCachedSetting("new_key")).toBe("value");
  });

  it("forgets a deleted key", () => {
    primeSettingsCache([{ key: "guac_url", value: "guacd:4822" }]);

    forgetCachedSetting("guac_url");

    expect(readCachedSetting("guac_url")).toBeNull();
  });

  it("ignores writes while unprimed instead of half-populating", () => {
    // A partially filled cache would be worse than an empty one: readers
    // could not tell a real value from a missing prime.
    updateCachedSetting("guac_url", "guacd:4822");

    expect(isSettingsCachePrimed()).toBe(false);
    expect(readCachedSetting("guac_url")).toBeNull();
  });

  it("replaces the previous contents when primed again", () => {
    primeSettingsCache([{ key: "old", value: "1" }]);
    primeSettingsCache([{ key: "new", value: "2" }]);

    expect(readCachedSetting("old")).toBeNull();
    expect(readCachedSetting("new")).toBe("2");
  });
});
