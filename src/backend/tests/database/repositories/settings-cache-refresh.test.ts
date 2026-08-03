import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshIntervalSeconds,
  startSettingsCacheRefresh,
  stopSettingsCacheRefresh,
} from "../../../database/repositories/factory.js";

/**
 * The settings cache lives in one process and is updated by whichever process
 * wrote the setting. On SQLite that is the only process there is. On Postgres
 * and MySQL — the reason those exist here is to let several instances share one
 * database — a setting changed on one replica would otherwise never reach the
 * others, because the synchronous read cannot go back to the database.
 *
 * Re-priming on a timer does not make settings immediately consistent. It
 * bounds how long they can disagree.
 */
describe("settings cache refresh", () => {
  afterEach(() => stopSettingsCacheRefresh());

  describe("interval", () => {
    it("defaults to something short enough to matter", () => {
      expect(refreshIntervalSeconds({})).toBe(30);
    });

    it("is configurable", () => {
      expect(
        refreshIntervalSeconds({ SETTINGS_CACHE_REFRESH_SECONDS: "5" }),
      ).toBe(5);
    });

    it("treats zero and nonsense as off", () => {
      expect(
        refreshIntervalSeconds({ SETTINGS_CACHE_REFRESH_SECONDS: "0" }),
      ).toBeNull();
      expect(
        refreshIntervalSeconds({ SETTINGS_CACHE_REFRESH_SECONDS: "-1" }),
      ).toBeNull();
      expect(
        refreshIntervalSeconds({ SETTINGS_CACHE_REFRESH_SECONDS: "soon" }),
      ).toBeNull();
    });
  });

  it("re-reads on the interval", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);

    startSettingsCacheRefresh(
      { SETTINGS_CACHE_REFRESH_SECONDS: "0.01" },
      refresh,
    );

    await vi.waitFor(() =>
      expect(refresh.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("keeps running after a refresh throws", async () => {
    // A transient database blip must not stop the loop, or the replica is stuck
    // on stale settings until it restarts — the exact failure this prevents.
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue(undefined);

    startSettingsCacheRefresh(
      { SETTINGS_CACHE_REFRESH_SECONDS: "0.01" },
      refresh,
    );

    await vi.waitFor(() =>
      expect(refresh.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("does nothing when switched off", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);

    startSettingsCacheRefresh({ SETTINGS_CACHE_REFRESH_SECONDS: "0" }, refresh);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops when told to, and does not stack timers", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);

    startSettingsCacheRefresh(
      { SETTINGS_CACHE_REFRESH_SECONDS: "0.02" },
      refresh,
    );
    startSettingsCacheRefresh(
      { SETTINGS_CACHE_REFRESH_SECONDS: "0.02" },
      refresh,
    );

    await new Promise((resolve) => setTimeout(resolve, 70));
    stopSettingsCacheRefresh();

    const afterStop = refresh.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refresh.mock.calls.length).toBe(afterStop);
  });
});
