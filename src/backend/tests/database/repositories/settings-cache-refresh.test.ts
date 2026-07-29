import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAll = vi.fn();

vi.mock("../../../database/repositories/settings-repository.js", () => ({
  SettingsRepository: class {
    listAll = listAll;
  },
}));
vi.mock("../../../database/db/index.js", () => ({
  getDb: () => ({}),
  getSqlite: () => {
    throw new Error("not sqlite");
  },
}));

/**
 * The settings cache lives in one process and is updated by whichever process
 * wrote the setting. On SQLite that is the only process there is. On Postgres
 * and MySQL — the reason this feature exists is to let several instances share
 * one database — a setting changed on one replica would otherwise never reach
 * the others, because the synchronous read cannot go back to the database.
 *
 * Re-priming on a timer does not make it immediately consistent. It bounds how
 * long it can be wrong.
 */
describe("settings cache refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listAll.mockReset();
    process.env.DATABASE_DIALECT = "postgres";
  });

  afterEach(async () => {
    const { stopSettingsCacheRefresh } =
      await import("../../../database/repositories/factory.js");
    stopSettingsCacheRefresh();
    vi.useRealTimers();
    delete process.env.DATABASE_DIALECT;
    delete process.env.SETTINGS_CACHE_REFRESH_SECONDS;
    vi.resetModules();
  });

  it("picks up a value another replica wrote", async () => {
    const { startSettingsCacheRefresh } =
      await import("../../../database/repositories/factory.js");
    const { readCachedSetting, primeSettingsCache } =
      await import("../../../database/repositories/settings-cache.js");

    primeSettingsCache([{ key: "allow_registration", value: "true" }]);
    listAll.mockResolvedValue([{ key: "allow_registration", value: "false" }]);

    startSettingsCacheRefresh({ SETTINGS_CACHE_REFRESH_SECONDS: "5" });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(readCachedSetting("allow_registration")).toBe("false");
  });

  it("keeps the previous values when a refresh fails", async () => {
    const { startSettingsCacheRefresh } =
      await import("../../../database/repositories/factory.js");
    const { readCachedSetting, primeSettingsCache } =
      await import("../../../database/repositories/settings-cache.js");

    primeSettingsCache([{ key: "guac_url", value: "http://guacd" }]);
    listAll.mockRejectedValue(new Error("connection reset"));

    startSettingsCacheRefresh({ SETTINGS_CACHE_REFRESH_SECONDS: "5" });
    await vi.advanceTimersByTimeAsync(5_000);

    // A database blip must not blank the cache — every caller reads a missing
    // setting as "use the default", so an empty cache silently reverts config.
    expect(readCachedSetting("guac_url")).toBe("http://guacd");
  });

  it("can be turned off", async () => {
    const { startSettingsCacheRefresh } =
      await import("../../../database/repositories/factory.js");

    startSettingsCacheRefresh({ SETTINGS_CACHE_REFRESH_SECONDS: "0" });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(listAll).not.toHaveBeenCalled();
  });
});
