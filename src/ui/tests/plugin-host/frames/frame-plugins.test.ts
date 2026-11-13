import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  authApi: {
    post: vi.fn(async () => ({ data: { token: "t", expiresIn: 300 } })),
    request: vi.fn(),
  },
}));

import { startFramedPlugin } from "@/plugin-host/frames/frame-plugins";
import { resetFrameConnections } from "@/plugin-host/frames/frame-connection";
import { getFrameValue } from "@/plugin-host/frames/frame-values";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import { getPanel, resetPanels } from "@/shell/panel-registry";
import { invokeAction } from "@/shell/action-registry";
import { listHostActions } from "@/sidebar/host-contributions";
import { listCompanionDefs } from "@/shell/companions";
import { FramePort } from "@/plugin-frame/rpc";
import { FRAME_CHANNEL, type FrameMessage } from "@/plugin-frame/protocol";

const summary = {
  id: "gizmo",
  name: "Gizmo",
  version: "1.0.0",
  enabled: true,
  state: "active",
  frontend: true,
  frontendIsolation: "frame",
  assetVersion: "v1",
  contributes: { panels: [{ id: "gizmo" }], tabs: [] },
} as unknown as PluginSummary;

/** Stands in for the plugin's background frame page. */
function fakeFrame(onCall: (method: string, args: unknown[]) => unknown) {
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[data-plugin-frame="gizmo"]',
  )!;
  const win = iframe.contentWindow!;
  const toShell = (message: FrameMessage) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: structuredClone(message),
        source: win,
      }),
    );
  const port = new FramePort({
    post: (message) => queueMicrotask(() => toShell(message)),
    onCall,
    fnPrefix: "p",
  });
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    queueMicrotask(() => port.receive(structuredClone(message)));
  });
  toShell({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
  return { iframe, port };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  resetPluginStore();
  resetPanels();
  setPluginSummaries([summary]);
});

afterEach(() => {
  resetFrameConnections();
  document.getElementById("termix-plugin-frames")?.remove();
  vi.restoreAllMocks();
});

describe("startFramedPlugin", () => {
  it("loads a sandboxed background frame from the plugin's asset folder", async () => {
    const started = startFramedPlugin(summary);
    const iframe = document.querySelector<HTMLIFrameElement>(
      'iframe[data-plugin-frame="gizmo"]',
    )!;
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.src).toContain("/plugin-assets/gizmo/_frame/frame.html#");
    expect(iframe.src).toContain("role=background");
    const { port } = fakeFrame(() => undefined);
    port.emit("ready");
    const plugin = await started;
    plugin.dispose();
    expect(document.querySelector('iframe[data-plugin-frame="gizmo"]')).toBe(
      null,
    );
  });

  it("replays what the frame registered and removes it again", async () => {
    const started = startFramedPlugin(summary);
    const { port } = fakeFrame(() => undefined);
    let whenCalls = 0;
    port.emit("register", {
      rid: "panel#1",
      kind: "panel",
      data: { id: "gizmo", component: { $component: "panel:gizmo" } },
    });
    port.emit("register", {
      rid: "action#2",
      kind: "action",
      data: { id: "gizmo.ping", handler: (value: number) => value * 2 },
    });
    port.emit("register", {
      rid: "hostAction#3",
      kind: "hostAction",
      data: {
        id: "gizmo.open",
        titleKey: "open",
        kind: "open",
        icon: { $icon: "Box" },
        when: (host: { pluginSettings?: Record<string, unknown> }) => {
          whenCalls++;
          // Each plugin only ever sees its own settings.
          return Object.keys(host.pluginSettings ?? {}).join(",") === "gizmo";
        },
      },
    });
    port.emit("value", { key: "rail:gizmo:badge", value: 3 });
    port.emit("ready");
    const plugin = await started;

    expect(getPanel("gizmo")?.pluginId).toBe("gizmo");
    await expect(invokeAction("gizmo.ping", 21)).resolves.toBe(42);
    expect(getFrameValue("gizmo", "rail:gizmo:badge")).toBe(3);

    const host = {
      id: 1,
      name: "h",
      ip: "1.2.3.4",
      pluginSettings: { gizmo: { on: true }, other: { secret: "x" } },
    };
    const action = listHostActions().find(
      (entry) => entry.id === "gizmo.open",
    )!;
    // The first answer is the safe default; the frame's answer follows.
    expect(action.when(host as never)).toBe(false);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const refreshed = listHostActions().find(
      (entry) => entry.id === "gizmo.open",
    )!;
    expect(refreshed.when(host as never)).toBe(true);
    expect(whenCalls).toBe(1);

    port.emit("unregister", { rid: "panel#1" });
    await flush();
    expect(getPanel("gizmo")).toBeUndefined();

    plugin.dispose();
    expect(listHostActions().some((entry) => entry.id === "gizmo.open")).toBe(
      false,
    );
    expect(getFrameValue("gizmo", "rail:gizmo:badge")).toBeUndefined();
  });

  it("hands a companion's when a plain tab and only the plugin's own host settings", async () => {
    const seen: unknown[][] = [];
    const started = startFramedPlugin(summary);
    const { port } = fakeFrame(() => undefined);
    port.emit("register", {
      rid: "companion#1",
      kind: "companion",
      data: {
        id: "side",
        component: { $component: "companion:side" },
        when: (...args: unknown[]) => {
          seen.push(args);
          return true;
        },
      },
    });
    port.emit("ready");
    const plugin = await started;
    const def = listCompanionDefs().find((entry) => entry.id === "gizmo.side")!;
    const host = {
      id: 3,
      name: "h",
      ip: "1.2.3.4",
      pluginSettings: { gizmo: { on: true }, other: { secret: "x" } },
    };
    const tab = {
      id: "t1",
      instanceId: "i1",
      type: "terminal",
      label: "h",
      host,
      handle: () => {},
    };
    expect(def.when!(tab as never, host as never)).toBe(false);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const refreshed = listCompanionDefs().find(
      (entry) => entry.id === "gizmo.side",
    )!;
    expect(refreshed.when!(tab as never, host as never)).toBe(true);
    const [sentTab, sentHost] = seen[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(sentTab).toEqual({
      id: "t1",
      instanceId: "i1",
      type: "terminal",
      label: "h",
      hostId: 3,
    });
    expect(sentHost.pluginSettings).toEqual({ gizmo: { on: true } });
    plugin.dispose();
  });

  it("fails when the frame reports a broken activate", async () => {
    const started = startFramedPlugin(summary);
    const { port } = fakeFrame(() => undefined);
    port.emit("failed", "activate threw");
    await expect(started).rejects.toThrow("activate threw");
    expect(document.querySelector('iframe[data-plugin-frame="gizmo"]')).toBe(
      null,
    );
  });

  it("refuses a registration the manifest does not declare", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const started = startFramedPlugin(summary);
    const { port } = fakeFrame(() => undefined);
    port.emit("register", {
      rid: "panel#9",
      kind: "panel",
      data: { id: "undeclared", component: { $component: "panel:undeclared" } },
    });
    port.emit("ready");
    const plugin = await started;
    expect(getPanel("undeclared")).toBeUndefined();
    expect(error).toHaveBeenCalled();
    plugin.dispose();
  });
});
