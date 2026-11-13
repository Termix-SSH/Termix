import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const installedPlugin = {
  id: "sample-plugin",
  name: "Sample",
  version: "1.0.0",
  enabled: true,
  state: "active",
  source: "user",
  capabilities: ["kv:own"],
  managedByServer: false,
  contributes: {},
};

const fail = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), {
    response: { data: { error: `${code} happened`, code, ...extra } },
  });

const api = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getPluginRegistry: vi.fn(),
  getDeveloperMode: vi.fn(async () => ({ enabled: false, signedOnly: false })),
  previewPluginState: vi.fn(),
  setPluginState: vi.fn(async () => ({ state: "active" })),
  setPluginOptions: vi.fn(async () => ({})),
  setAllPluginChannels: vi.fn(async () => ({})),
  installPlugin: vi.fn(async () => ({ state: "active" })),
  uninstallPlugin: vi.fn(async () => ({})),
  deletePluginData: vi.fn(async () => ({})),
  retryPlugin: vi.fn(async () => ({})),
  updatePlugin: vi.fn(async () => ({})),
  updateAllPlugins: vi.fn(async () => ({ updated: [], failed: [] })),
}));
const confirmAnswer = vi.hoisted(() => ({ value: true }));
vi.mock("@/api/plugins-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/plugins-api")>()),
  ...api,
}));
vi.mock("@/components/surface/surface-scope", () => ({
  useConfirm: () => vi.fn(async () => confirmAnswer.value),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

import { DEVELOPER_MODE_CHANGED_EVENT } from "@/api/plugins-api";
import { usePluginsManager } from "@/plugins/use-plugins-manager";

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer.value = true;
  api.getPlugins.mockResolvedValue([installedPlugin]);
  api.getPluginRegistry.mockResolvedValue({
    plugins: [],
    managedByServer: false,
    registry: { error: null, lastCheckedAt: "now" },
    registries: [],
  });
  api.previewPluginState.mockResolvedValue({
    enable: [],
    disable: [],
    missing: [],
  });
});

async function ready() {
  const hook = renderHook(() => usePluginsManager());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("loading", () => {
  it("shows the registry error but keeps installed plugins", async () => {
    api.getPluginRegistry.mockRejectedValue(new Error("offline"));
    const { result } = await ready();
    expect(result.current.registryError).toBe("offline");
    expect(result.current.plugins).toHaveLength(1);
  });

  it("follows the developer mode switch", async () => {
    const { result } = await ready();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DEVELOPER_MODE_CHANGED_EVENT, { detail: true }),
      );
    });
    expect(result.current.developerMode).toBe(true);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DEVELOPER_MODE_CHANGED_EVENT, { detail: "x" }),
      );
    });
    expect(result.current.developerMode).toBe(true);
  });
});

describe("turning plugins off and on", () => {
  it("asks before turning off plugins that depend on it", async () => {
    const { result } = await ready();
    api.previewPluginState.mockResolvedValue({
      enable: [],
      disable: ["other-plugin"],
      missing: [],
    });
    confirmAnswer.value = false;
    await act(async () => result.current.toggle(result.current.plugins[0]));
    expect(api.setPluginState).not.toHaveBeenCalled();
    confirmAnswer.value = true;
    await act(async () => result.current.toggle(result.current.plugins[0]));
    expect(api.setPluginState).toHaveBeenCalledWith("sample-plugin", false);
  });

  it("refuses to turn on a plugin with missing dependencies", async () => {
    api.getPlugins.mockResolvedValue([{ ...installedPlugin, enabled: false }]);
    const { result } = await ready();
    api.previewPluginState.mockResolvedValue({
      enable: [],
      disable: [],
      missing: ["needed"],
    });
    await act(async () => result.current.toggle(result.current.plugins[0]));
    expect(toasts.error).toHaveBeenCalledWith(
      "plugins.manager.errors.missingDependencies",
    );
    expect(api.setPluginState).not.toHaveBeenCalled();
  });

  it("explains the server's error codes", async () => {
    const { result } = await ready();
    for (const [code, key] of [
      ["MANAGED_BY_SERVER", "plugins.manager.errors.managedByServer"],
      ["DEFAULT_LOOK", "plugins.manager.errors.defaultLook"],
      ["HAS_DEPENDENTS", "plugins.manager.errors.hasDependents"],
      ["OTHER", "plugins.manager.errors.state"],
    ]) {
      api.setPluginState.mockRejectedValueOnce(
        fail(code, { dependents: ["x"] }),
      );
      await act(async () => result.current.toggle(result.current.plugins[0]));
      expect(toasts.error).toHaveBeenLastCalledWith(key);
    }
  });

  it("says when a change waits on the admin hold", async () => {
    api.setPluginState.mockResolvedValueOnce({
      held: true,
      holdId: "h1",
      minutes: 15,
    } as never);
    const { result } = await ready();
    await act(async () => result.current.toggle(result.current.plugins[0]));
    expect(toasts.info.mock.calls.length + toasts.error.mock.calls.length).toBe(
      1,
    );
  });
});

describe("install, uninstall and data", () => {
  it("installs after consent and asks again when the capabilities changed", async () => {
    api.getPluginRegistry.mockResolvedValue({
      plugins: [
        {
          id: "new-plugin",
          name: "New",
          description: "d",
          versions: [{ version: "2.0.0", capabilities: ["net:fetch"] }],
          latestVersion: "2.0.0",
        },
      ],
      managedByServer: false,
      registry: { error: null },
      registries: [],
    });
    const { result } = await ready();
    const fresh = result.current.plugins.find((p) => p.id === "new-plugin")!;
    act(() => result.current.requestInstall(fresh));
    expect(result.current.consent).toMatchObject({
      mode: "install",
      version: "2.0.0",
    });
    api.installPlugin.mockRejectedValueOnce(
      fail("CONSENT_MISMATCH", { capabilities: ["net:fetch", "ssh:exec"] }),
    );
    await act(async () => result.current.confirmConsent());
    expect(result.current.consent).toMatchObject({
      capabilities: ["net:fetch", "ssh:exec"],
    });
    await act(async () => result.current.confirmConsent());
    expect(api.installPlugin).toHaveBeenCalledTimes(2);
    expect(toasts.success).toHaveBeenCalledWith(
      "plugins.manager.toast.installed",
    );
  });

  it("uninstalls and deletes data only after a yes", async () => {
    const { result } = await ready();
    const plugin = result.current.plugins[0];
    confirmAnswer.value = false;
    expect(await act(async () => result.current.uninstall(plugin))).toBe(false);
    expect(await act(async () => result.current.removeData(plugin))).toBe(
      false,
    );
    confirmAnswer.value = true;
    expect(await act(async () => result.current.uninstall(plugin))).toBe(true);
    expect(await act(async () => result.current.removeData(plugin))).toBe(true);
    api.uninstallPlugin.mockRejectedValueOnce(fail("X"));
    expect(await act(async () => result.current.uninstall(plugin))).toBe(false);
  });

  it("retries, sets options and leaves betas", async () => {
    const { result } = await ready();
    const plugin = result.current.plugins[0];
    api.retryPlugin.mockRejectedValueOnce(fail("X"));
    await act(async () => result.current.retry(plugin));
    expect(toasts.error).toHaveBeenLastCalledWith(
      "plugins.manager.errors.retry",
    );
    await act(async () =>
      result.current.setOptions(plugin, { autoUpdate: true }),
    );
    expect(api.setPluginOptions).toHaveBeenCalledWith("sample-plugin", {
      autoUpdate: true,
    });
    await act(async () =>
      result.current.leaveBeta({ ...plugin, isBeta: true } as never),
    );
    expect(toasts.info).toHaveBeenCalledWith(
      "plugins.manager.beta.leftWhileOnBeta",
    );
    confirmAnswer.value = false;
    await act(async () => result.current.setRunUnisolated(plugin, true));
    expect(api.setPluginOptions).toHaveBeenCalledTimes(2);
  });

  it("updates everything and reports each failure", async () => {
    const { result } = await ready();
    api.updateAllPlugins.mockResolvedValueOnce({
      updated: ["a", "b"],
      failed: [{ id: "sample-plugin", error: "boom" }],
    });
    await act(async () => result.current.updateAll());
    expect(toasts.success).toHaveBeenCalledWith(
      "plugins.manager.toast.updatedMany",
    );
    expect(toasts.error).toHaveBeenCalledWith("plugins.manager.errors.update");
    api.updateAllPlugins.mockRejectedValueOnce(fail("X"));
    await act(async () => result.current.updateAll());
    await act(async () => result.current.setAllChannels("beta"));
    expect(api.setAllPluginChannels).toHaveBeenCalledWith("beta");
  });
});
