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
      foreign: {
        getExtension: vi.fn(() => undefined),
      } as never,
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

describe("host actions inside a frame", () => {
  it("asks the shell which actions apply and runs them through it", async () => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { setFrameState, resetFrameState } =
      await import("@/plugin-frame/frame-store");
    resetFrameState();
    setFrameState({
      hostActions: [
        {
          id: "files.open",
          pluginId: "files",
          titleKey: "files:nav.files",
          title: "Files",
          kind: "open",
        },
        { id: "box.open", pluginId: "box", titleKey: "b", kind: "open" },
      ],
    });
    const call = vi.fn(async (method: string) =>
      method === "hostActions.when" ? [["files", "files.open"]] : null,
    );
    const bridge = createFrameBridge({
      pluginId: "terminal",
      call,
      getApi: vi.fn() as never,
      tabs: {} as never,
      foreign: {} as never,
    });
    const host = { id: "7" };
    const { result } = renderHook(() => bridge.useHostActions());
    const visible = () =>
      result.current
        .filter((action) => action.when(host as never))
        .map((action) => action.id);
    expect(visible()).toEqual([]);
    const i18n = (await import("@/i18n/i18n")).default;
    expect(i18n.t("files:nav.files")).toBe("Files");
    await waitFor(() => expect(visible()).toEqual(["files.open"]));
    expect(
      call.mock.calls.filter(([method]) => method === "hostActions.when"),
    ).toHaveLength(1);

    result.current[0].run!(host as never, {} as never);
    expect(call).toHaveBeenCalledWith(
      "hostActions.run",
      "files",
      "files.open",
      "7",
    );
    resetFrameState();
  });
});

describe("host actions answered late", () => {
  it("asks again while the shell waits on plugins, and gives run only to actions with one", async () => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { setFrameState, resetFrameState } =
      await import("@/plugin-frame/frame-store");
    resetFrameState();
    setFrameState({
      hostActions: [
        {
          id: "files.open",
          pluginId: "files",
          titleKey: "f",
          kind: "open",
          tabType: "files",
          hasRun: false,
        },
      ],
    });
    let answers = 0;
    const call = vi.fn(async (method: string) => {
      if (method !== "hostActions.when") return null;
      answers += 1;
      // The first answer comes before the other plugin answered the shell.
      return answers === 1
        ? { pairs: [], pending: true }
        : { pairs: [["files", "files.open"]], pending: false };
    });
    const bridge = createFrameBridge({
      pluginId: "operations-center",
      call,
      getApi: vi.fn() as never,
      tabs: {} as never,
      foreign: {} as never,
    });
    const host = { id: "3" };
    const { result } = renderHook(() => bridge.useHostActions());
    const visible = () =>
      result.current
        .filter((action) => action.when(host as never))
        .map((action) => action.id);
    expect(visible()).toEqual([]);
    await waitFor(() => expect(visible()).toEqual(["files.open"]), {
      timeout: 2_000,
    });
    expect(result.current[0].run).toBeUndefined();
    resetFrameState();
  });
});

describe("live work", () => {
  it("does not count a settings listener", async () => {
    const { liveWork, resetLiveTracking, startLiveTracking } =
      await import("@/plugin-frame/frame-liveness");
    resetLiveTracking();
    startLiveTracking();
    const { app, dispose } = createFrameApp({
      pluginId: "gizmo",
      role: "background",
      manifest: { id: "gizmo", name: "Gizmo", contributes: {} } as never,
      register: vi.fn(),
      unregister: vi.fn(),
      call: vi.fn(async () => null),
      api: {} as never,
      fetch: vi.fn() as never,
      wsUrl: vi.fn() as never,
    });
    app.onSettingsChanged(() => {});
    expect(liveWork()).toEqual([]);
    dispose();
    resetLiveTracking();
  });
});
