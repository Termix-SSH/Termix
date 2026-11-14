import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getPluginUserSettings = vi.hoisted(() => vi.fn());
const getPluginHostSettings = vi.hoisted(() => vi.fn());

vi.mock("@/api/plugins-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/plugins-api")>()),
  getPluginUserSettings,
  getPluginHostSettings,
}));

import {
  pluginHostBridge,
  toHostRecord,
  toPluginHostRecord,
} from "@/plugin-host/bridge";
import { registerHostProtocol } from "@/sidebar/host-protocols";
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

describe("useSettings for hosts", () => {
  it("never shows the last host's values for a new host", async () => {
    let finish: (values: Record<string, unknown>) => void = () => {};
    getPluginHostSettings.mockResolvedValueOnce({ port: 1 });
    const { result, rerender } = renderHook(
      ({ hostId }: { hostId: number }) =>
        pluginHostBridge.useSettings("docker", "host", hostId),
      { initialProps: { hostId: 1 } },
    );
    await waitFor(() => expect(result.current.values).toEqual({ port: 1 }));

    getPluginHostSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    rerender({ hostId: 2 });
    expect(result.current.loaded).toBe(false);
    expect(result.current.values).toEqual({});

    await act(async () => finish({ port: 2 }));
    expect(result.current.values).toEqual({ port: 2 });
    expect(result.current.loaded).toBe(true);
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

  it("passes the saved password flags so a terminal can offer to fill them", () => {
    const record = toHostRecord({
      id: 7,
      hasPassword: true,
      hasSudoPassword: true,
      sudoPassword: "secret",
    } as never);
    expect(record).toMatchObject({ hasPassword: true, hasSudoPassword: true });
    expect(record).not.toHaveProperty("sudoPassword");
  });
});

describe("useTheme", () => {
  it("reports the mode of the shown theme, plugin themes included", async () => {
    const { ThemeProvider, useTheme: useAppTheme } =
      await import("@/components/theme-provider");
    const { setPluginThemes, resetPluginThemes } =
      await import("@/look/theme-registry");
    const { createElement } = await import("react");
    let setTheme: ((id: string) => void) | null = null;
    const { result } = renderHook(
      () => {
        setTheme = useAppTheme().setTheme;
        return pluginHostBridge.useTheme();
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) =>
          createElement(ThemeProvider, {
            storageKey: "bridge-theme",
            children,
          }),
      },
    );
    expect(result.current.theme).toBe("dark");
    act(() => setTheme!("light"));
    expect(result.current.theme).toBe("light");
    act(() =>
      setPluginThemes([
        {
          id: "paper",
          label: "Paper",
          mode: "light",
          swatch: { background: "#fff", panel: "#eee", text: "#111" },
          pluginId: "x",
        },
      ]),
    );
    act(() => setTheme!("paper"));
    expect(result.current.theme).toBe("light");
    // Gone themes follow the OS once the plugin list is known.
    act(() => setTheme!("dracula"));
    expect(["light", "dark"]).toContain(result.current.theme);
    resetPluginThemes();
    localStorage.removeItem("bridge-theme");
  });
});

describe("useShell", () => {
  it("is null outside the signed-in shell", () => {
    const { result } = renderHook(() => pluginHostBridge.useShell());
    expect(result.current).toBeNull();
  });
});

describe("toPluginHostRecord", () => {
  it("hands a quick connect login only to the plugin whose protocol it opens", () => {
    const remove = registerHostProtocol({
      id: "rdp",
      pluginId: "remote",
      settingKey: "enableRdp",
      defaultPort: 3389,
      titleKey: "rdp",
      icon: () => null,
    });
    const host = {
      id: "quick-1",
      name: "q",
      ip: "10.0.0.2",
      quickConnectLogin: { protocol: "rdp", username: "u", password: "p" },
      pluginSettings: { remote: { enableRdp: true } },
    } as never;
    try {
      expect(toPluginHostRecord(host, "remote").quickConnectLogin).toEqual({
        protocol: "rdp",
        username: "u",
        password: "p",
      });
      expect(
        toPluginHostRecord(host, "other").quickConnectLogin,
      ).toBeUndefined();
      expect(toPluginHostRecord(host, null).quickConnectLogin).toBeUndefined();
    } finally {
      remove();
    }
  });
});
