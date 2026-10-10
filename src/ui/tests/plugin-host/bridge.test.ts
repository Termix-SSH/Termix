import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getPluginUserSettings = vi.hoisted(() => vi.fn());

vi.mock("@/api/plugins-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/plugins-api")>()),
  getPluginUserSettings,
}));

import { pluginHostBridge, toHostRecord } from "@/plugin-host/bridge";
import { PLUGIN_SETTINGS_CHANGED_EVENT } from "@/api/plugins-api";

afterEach(cleanup);

function announce(pluginId: string, scope: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(PLUGIN_SETTINGS_CHANGED_EVENT, {
        detail: { pluginId, scope },
      }),
    );
  });
}

describe("useSettings", () => {
  it("reads again when the settings page saves the same plugin and scope", async () => {
    getPluginUserSettings.mockResolvedValueOnce({ enabled: false });
    const { result } = renderHook(() =>
      pluginHostBridge.useSettings("ai", "user"),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.values).toEqual({ enabled: false });

    getPluginUserSettings.mockResolvedValue({ enabled: true });
    announce("other", "user");
    announce("ai", "admin");
    expect(getPluginUserSettings).toHaveBeenCalledTimes(1);

    announce("ai", "user");
    await waitFor(() =>
      expect(result.current.values).toEqual({ enabled: true }),
    );
  });
});

describe("toHostRecord", () => {
  it("copies only the fields the SDK types", () => {
    const record = toHostRecord({
      id: 7,
      name: "web",
      ip: "10.0.0.7",
      port: 22,
      username: "root",
      parentHostId: 3,
      jumpHosts: [{ hostId: 2 }],
      pluginSettings: { docker: { enableDocker: true } },
      authOverrides: { ssh: { required: true, ownerAuthShared: false } },
      password: "secret",
      terminalConfig: { fontSize: 14 },
      enableDocker: true,
    } as never);

    expect(record).toMatchObject({
      id: "7",
      name: "web",
      parentHostId: "3",
      jumpHosts: [{ hostId: 2 }],
      pluginSettings: { docker: { enableDocker: true } },
      authOverrides: { ssh: { required: true, ownerAuthShared: false } },
    });
    const loose = record as unknown as Record<string, unknown>;
    expect(loose).not.toHaveProperty("password");
    expect(loose).not.toHaveProperty("terminalConfig");
    expect(loose).not.toHaveProperty("enableDocker");
  });
});
