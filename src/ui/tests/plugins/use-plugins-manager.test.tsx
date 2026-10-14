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
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
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
