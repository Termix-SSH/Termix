import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getPlugins: vi.fn(async () => [
    {
      id: "sample-plugin",
      name: "Sample",
      version: "1.0.0",
      enabled: false,
      state: "loaded",
      source: "user",
      capabilities: ["kv:own"],
      managedByServer: false,
      contributes: {},
    },
  ]),
  getPluginRegistry: vi.fn(async () => ({
    plugins: [],
    managedByServer: true,
    registry: {},
  })),
  getDeveloperMode: vi.fn(async () => ({ enabled: false, signedOnly: false })),
  previewPluginState: vi.fn(async () => ({
    enable: [],
    disable: [],
    missing: [],
  })),
  setPluginState: vi.fn(async () => ({ state: "active" })),
}));
vi.mock("@/api/plugins-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/plugins-api")>()),
  ...api,
}));
vi.mock("@/components/surface/surface-scope", () => ({
  useConfirm: () => vi.fn(async () => true),
}));
const i18n = vi.hoisted(() => {
  const strings: Record<string, string> = {
    "sample-plugin:plugin.name": "示例",
    "sample-plugin:plugin.description": "一个示例插件",
  };
  return {
    t: (key: string, options?: { defaultValue?: string }) =>
      strings[key] ?? options?.defaultValue ?? key,
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => i18n }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { usePluginsManager } from "@/plugins/use-plugins-manager";

it("waits for local consent and sends the reviewed version and capabilities", async () => {
  const { result } = renderHook(() => usePluginsManager());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const plugin = result.current.plugins[0];
  await act(async () => {
    await result.current.toggle(plugin);
  });
  expect(result.current.consent).toMatchObject({
    mode: "enable",
    version: "1.0.0",
    capabilities: ["kv:own"],
  });
  expect(api.setPluginState).not.toHaveBeenCalled();
  act(() => result.current.setConsent(null));
  expect(api.setPluginState).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.toggle(plugin);
  });
  await act(async () => {
    await result.current.confirmConsent();
  });
  expect(api.setPluginState).toHaveBeenCalledExactlyOnceWith(
    "sample-plugin",
    true,
    { version: "1.0.0", capabilities: ["kv:own"] },
  );
});

it("names plugins in the UI language, falling back to the manifest", async () => {
  api.getPluginRegistry.mockResolvedValueOnce({
    plugins: [
      {
        id: "browse-only",
        name: "Browse Only",
        description: "Not installed",
        author: "someone",
        category: "Tools",
        latestVersion: "1.0.0",
        versions: [],
        bundled: false,
      },
    ],
    managedByServer: true,
    registry: {},
  } as never);
  const { result } = renderHook(() => usePluginsManager());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(
    result.current.plugins.map(({ name, description }) => ({
      name,
      description,
    })),
  ).toEqual([
    { name: "示例", description: "一个示例插件" },
    { name: "Browse Only", description: "Not installed" },
  ]);
});
