import { describe, expect, it, vi } from "vitest";
import { createFrameApp } from "@/plugin-frame/frame-app";
import { createFrameBridge } from "@/plugin-frame/frame-bridge";

function Widget() {
  return null;
}

describe("extensions inside a frame", () => {
  it("lets the plugin read its own extensions with their components", () => {
    const register = vi.fn();
    const { app, dispose } = createFrameApp({
      pluginId: "homepage",
      role: "view",
      manifest: { id: "homepage", name: "Homepage", contributes: {} } as never,
      register,
      unregister: vi.fn(),
      call: vi.fn(async () => null),
      api: {} as never,
      fetch: vi.fn() as never,
      wsUrl: vi.fn() as never,
    });
    const bridge = createFrameBridge({
      pluginId: "homepage",
      call: vi.fn(async () => null),
      getApi: vi.fn() as never,
      tabs: {} as never,
    });
    const drop = app.registerExtension("homepage.widgets", {
      id: "clock",
      components: { view: Widget },
    });
    const found = bridge.getExtension("homepage.widgets", "clock");
    expect(found?.components?.view).toBe(Widget);
    expect(found?.pluginId).toBe("homepage");
    expect(register).not.toHaveBeenCalled();
    drop();
    expect(bridge.getExtension("homepage.widgets", "clock")).toBeUndefined();
    dispose();
  });
});
