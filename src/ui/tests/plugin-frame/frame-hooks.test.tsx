import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { addHook, FrameHooks, removeHook } from "@/plugin-frame/frame-hooks";
import { resetFrameState, setFrameState } from "@/plugin-frame/frame-store";
import { createFrameApp } from "@/plugin-frame/frame-app";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/frontend";

afterEach(() => {
  removeHook("data:row");
  resetFrameState();
});

describe("FrameHooks per row", () => {
  it("runs a data hook once per row on screen and sends one table", async () => {
    const send = vi.fn();
    const use = vi.fn((context: Record<string, unknown>, rowKey: string) => ({
      shape: "text",
      text: `${rowKey}:${String((context.host as { name?: string })?.name)}:${String(context.online)}`,
    }));
    setFrameState({
      hosts: [
        { id: 1, name: "one" },
        { id: 2, name: "two" },
      ],
      dataRows: {
        "data:row": {
          "1": { hostId: 1, online: true },
          "2": { hostId: 2, online: false },
        },
      },
    });
    addHook({ key: "data:row", use: use as never, perRow: true });
    render(<FrameHooks send={send} />);
    await act(async () => {});
    expect(send).toHaveBeenLastCalledWith("data:row", {
      "1": { shape: "text", text: "1:one:true" },
      "2": { shape: "text", text: "2:two:false" },
    });

    // A row leaving the screen stops its hook and leaves the table.
    send.mockClear();
    use.mockClear();
    await act(async () => {
      setFrameState({
        dataRows: { "data:row": { "2": { hostId: 2, online: false } } },
      });
    });
    expect(send).toHaveBeenLastCalledWith("data:row", {
      "2": { shape: "text", text: "2:two:false" },
    });
    expect(use.mock.calls.every(([, rowKey]) => rowKey !== "1")).toBe(true);
  });

  it("sends nothing when no row is shown", async () => {
    const send = vi.fn();
    addHook({ key: "data:row", use: (() => null) as never, perRow: true });
    render(<FrameHooks send={send} />);
    await act(async () => {});
    expect(send).not.toHaveBeenCalled();
  });
});

describe("frame app value registrations", () => {
  const manifest = {
    id: "gizmo",
    name: "Gizmo",
    version: "1.0.0",
  } as unknown as PluginManifest;

  function frameApp() {
    const registered: { kind: string; data: Record<string, unknown> }[] = [];
    const handle = createFrameApp({
      pluginId: "gizmo",
      role: "background",
      manifest,
      register: (_rid, kind, data) =>
        registered.push({ kind, data: data as Record<string, unknown> }),
      unregister: () => {},
      call: async () => undefined,
      api: {} as never,
      fetch: (() => {}) as never,
      wsUrl: (() => "") as never,
      warn: () => {},
    });
    return { app: handle.app, registered, dispose: handle.dispose };
  }

  it("registers data slot values, host values, status indicators and toolbar items", () => {
    const { app, registered, dispose } = frameApp();
    app.registerSlotContribution("dashboard.hostRow", {
      actionId: "gizmo.row",
      titleKey: "row",
      kind: "data",
      useValue: () => null,
    });
    app.registerHostBadge({
      id: "b",
      when: () => true,
      useValue: () => null,
    });
    app.registerHostStatusIndicator({
      id: "s",
      when: () => true,
      useValue: () => null,
    });
    app.registerHostEditorToolbarItem({
      id: "t",
      when: () => true,
      useValue: () => null,
    });
    expect(
      registered.map((entry) => [entry.kind, entry.data.valueKey]),
    ).toEqual([
      ["slotContribution", "data:dashboard.hostRow:gizmo.row"],
      ["hostBadge", "badge:b:value"],
      ["hostStatusIndicator", "status:s:value"],
      ["hostEditorToolbarItem", "toolbar:t:value"],
    ]);
    expect(registered[0].data.useValue).toBeUndefined();
    dispose();
  });

  it("still refuses components where a frame can't draw them", () => {
    const { app, dispose } = frameApp();
    const Component = () => null;
    expect(() =>
      app.registerHostStatusIndicator({
        id: "s",
        when: () => true,
        component: Component,
      }),
    ).toThrow(/useValue/);
    expect(() =>
      app.registerHostEditorToolbarItem({
        id: "t",
        when: () => true,
        component: Component,
      }),
    ).toThrow(/useValue/);
    expect(() =>
      app.registerHostBadge({
        id: "b",
        when: () => true,
        component: Component,
      }),
    ).toThrow(/useValue/);
    dispose();
  });
});
