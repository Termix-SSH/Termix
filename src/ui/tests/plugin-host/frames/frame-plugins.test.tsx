import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  authApi: {
    post: vi.fn(async (_url: string, body?: { ids: string[] }) => ({
      data: {
        tokens: Object.fromEntries(
          (body?.ids ?? []).map((id) => [id, { token: "t", expiresIn: 300 }]),
        ),
      },
    })),
    request: vi.fn(),
  },
}));

import {
  slotFit,
  startFramedPlugin,
  VALUE_GRACE_MS,
} from "@/plugin-host/frames/frame-plugins";
import { resetFrameConnections } from "@/plugin-host/frames/frame-connection";
import { resetRegistrationCache } from "@/plugin-host/frames/registration-cache";
import { getFrameValue } from "@/plugin-host/frames/frame-values";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import { getPanel, resetPanels } from "@/shell/panel-registry";
import { getRegisteredDashboardCard } from "@/dashboard/dashboard-cards-registry";
import {
  invokeAction,
  registerAction,
  registerSlotContribution,
} from "@/shell/action-registry";
import { listHostActions } from "@/sidebar/host-contributions";
import { listCompanionDefs } from "@/shell/companions";
import {
  getHostEditorSection,
  resetHostEditorSections,
} from "@/sidebar/HostManagerTabs";
import { FramePort } from "@/plugin-frame/rpc";
import { FRAME_CHANNEL, type FrameMessage } from "@/plugin-frame/protocol";
import { act, render, waitFor } from "@testing-library/react";
import { DataSlot, HostDataItems } from "@/components/data-view/DataSlot";
import { setPermissionsForTesting } from "@/hooks/use-permissions";
import { dataRowsFor, resetDataRows } from "@/plugin-host/frames/data-rows";
import { listHostStatusIndicators } from "@/sidebar/host-contributions";
import {
  DataWatchHost,
  resetDataWatches,
} from "@/plugin-host/frames/data-watches";
import { dataReporter } from "@/components/data-view/data-reporter";
import {
  HostTreeChildren,
  resetHostTreeChildren,
} from "@/shell/host-tree-children";

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

/** The background frame element, once the cache lookup is done. */
async function frameElement(): Promise<HTMLIFrameElement> {
  for (let i = 0; i < 50; i++) {
    const found = document.querySelector<HTMLIFrameElement>(
      'iframe[data-plugin-frame="gizmo"]',
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("no background frame");
}

/** Stands in for the plugin's background frame page. */
async function fakeFrame(
  onCall: (method: string, args: unknown[]) => unknown,
  onEvent?: (name: string, data: unknown) => void,
) {
  const iframe = await frameElement();
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
    onEvent,
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
  resetRegistrationCache();
  resetFrameConnections();
  document.getElementById("termix-plugin-frames")?.remove();
  vi.restoreAllMocks();
});

describe("startFramedPlugin", () => {
  it("loads a sandboxed background frame from the plugin's asset folder", async () => {
    const started = startFramedPlugin(summary);
    const iframe = await frameElement();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.src).toContain("/plugin-assets/gizmo/_frame/frame.html#");
    expect(iframe.src).toContain("role=background");
    const { port } = await fakeFrame(() => undefined);
    port.emit("ready");
    const plugin = await started;
    plugin.dispose();
    expect(document.querySelector('iframe[data-plugin-frame="gizmo"]')).toBe(
      null,
    );
  });

  it("draws a dashboard card see-through, so the layout's card color shows", async () => {
    const started = startFramedPlugin({
      ...summary,
      contributes: {
        ...summary.contributes,
        dashboardCards: [{ id: "gizmo.card" }],
      },
    } as unknown as PluginSummary);
    const { port } = await fakeFrame(() => undefined);
    port.emit("register", {
      rid: "dashboardCard#1",
      kind: "dashboardCard",
      data: {
        id: "gizmo.card",
        labelKey: "card",
        component: { $component: "card:gizmo" },
      },
    });
    port.emit("ready");
    const plugin = await started;
    const Card = getRegisteredDashboardCard("gizmo.card")!
      .component as unknown as ComponentType;
    const view = render(<Card />);
    await act(flush);
    const src = view.container.querySelector("iframe")!.getAttribute("src")!;
    expect(src).toContain("bg=none");
    // Its fields stay on the page colors, not the sidebar's.
    expect(src).not.toContain("on=sidebar");
    view.unmount();
    plugin.dispose();
  });

  it("replays what the frame registered and removes it again", async () => {
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(() => undefined);
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

  it("hides a host editor section until the frame says it is visible", async () => {
    resetHostEditorSections();
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(() => undefined);
    port.emit("register", {
      rid: "hostEditorSection#1",
      kind: "hostEditorSection",
      data: {
        id: "gizmo",
        group: "top",
        labelKey: "gizmo",
        component: { $component: "hostSection:gizmo" },
        visible: (protocols: Record<string, boolean>) =>
          !!protocols.enableGizmo,
      },
    });
    port.emit("ready");
    const plugin = await started;

    const on = { enableSsh: true, enableGizmo: true };
    const off = { enableSsh: true, enableGizmo: false };
    expect(getHostEditorSection("gizmo")?.visible?.(on)).toBe(false);
    expect(getHostEditorSection("gizmo")?.visible?.(off)).toBe(false);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getHostEditorSection("gizmo")?.visible?.(on)).toBe(true);
    expect(getHostEditorSection("gizmo")?.visible?.(off)).toBe(false);

    plugin.dispose();
    resetHostEditorSections();
  });

  it("hands a companion's when a plain tab and only the plugin's own host settings", async () => {
    const seen: unknown[][] = [];
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(() => undefined);
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
    const { port } = await fakeFrame(() => undefined);
    // The app does not wait for the frame: the failure shows on ready.
    const plugin = await started;
    port.emit("failed", "activate threw");
    await expect(plugin.ready).rejects.toThrow("activate threw");
    expect(document.querySelector('iframe[data-plugin-frame="gizmo"]')).toBe(
      null,
    );
  });

  it("refuses a registration the manifest does not declare", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(() => undefined);
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

describe("data values from a frame", () => {
  afterEach(() => resetDataRows());

  it("keeps values on screen while a fresh frame loads its own data", async () => {
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(() => undefined);
    port.emit("value", { key: "row:held", value: "cached" });
    await flush();
    port.emit("ready");
    const plugin = await started;
    expect(getFrameValue("gizmo", "row:held")).toBe("cached");

    port.emit("value", { key: "row:held", value: "empty" });
    port.emit("value", { key: "row:held", value: "real" });
    port.emit("value", { key: "row:new", value: "shown" });
    await flush();
    expect(getFrameValue("gizmo", "row:held")).toBe("cached");
    expect(getFrameValue("gizmo", "row:new")).toBe("shown");

    await new Promise((resolve) => setTimeout(resolve, VALUE_GRACE_MS + 50));
    // Applied even though this cold frame stopped meanwhile.
    expect(getFrameValue("gizmo", "row:held")).toBe("real");
    plugin.dispose();
  });

  it("tells the frame which rows are shown and draws the values it sends", async () => {
    const states: Record<string, unknown>[] = [];
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(
      () => undefined,
      (name, data) => {
        if (name === "state") states.push(data as Record<string, unknown>);
      },
    );
    const valueKey = "data:dashboard.hostRow:gizmo.row";
    port.emit("register", {
      rid: "slotContribution#1",
      kind: "slotContribution",
      data: {
        slotId: "dashboard.hostRow",
        actionId: "gizmo.row",
        titleKey: "row",
        kind: "data",
        valueKey,
      },
    });
    port.emit("register", {
      rid: "hostStatusIndicator#2",
      kind: "hostStatusIndicator",
      data: { id: "s", when: () => true, valueKey: "status:s:value" },
    });
    port.emit("ready");
    const plugin = await started;
    setPermissionsForTesting([]);

    const host = {
      id: 1,
      name: "h",
      ip: "1.2.3.4",
      password: "hunter2",
      pluginSettings: { gizmo: {}, other: { secret: "x" } },
    };
    const view = render(
      <DataSlot
        slotId="dashboard.hostRow"
        rowKey={1}
        context={{ hostId: 1, host, online: true }}
      />,
    );
    await act(flush);
    // The row crosses as plain data, the host only as its id.
    expect(dataRowsFor("gizmo")).toEqual({
      [valueKey]: { "1": { hostId: 1, online: true } },
    });
    expect(states.at(-1)).toEqual({
      dataRows: { [valueKey]: { "1": { hostId: 1, online: true } } },
    });
    expect(JSON.stringify(states)).not.toContain("hunter2");

    await act(async () => {
      port.emit("value", {
        key: valueKey,
        value: { "1": { shape: "text", text: "busy" } },
      });
      await flush();
    });
    expect(view.container.textContent).toBe("busy");

    const indicators = listHostStatusIndicators().filter(
      (item) => item.pluginId === "gizmo",
    );
    const dots = render(
      <HostDataItems host={host as never} items={indicators} />,
    );
    await act(async () => {
      port.emit("value", {
        key: "status:s:value",
        value: { "1": { shape: "dot", tone: "bad", label: "down" } },
      });
      await flush();
    });
    expect(
      dots.container
        .querySelector("[data-data-dot='bad']")
        ?.getAttribute("title"),
    ).toBe("down");

    view.unmount();
    await act(flush);
    expect(dataRowsFor("gizmo")).toEqual({});
    plugin.dispose();
  });
});

describe("host tree children from a frame", () => {
  afterEach(() => {
    resetDataRows();
    resetHostTreeChildren();
  });

  it("asks only for a host that is shown and lists what the frame sends", async () => {
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(() => undefined);
    const valueKey = "tree:containers:children";
    port.emit("register", {
      rid: "hostTreeChildren#1",
      kind: "hostTreeChildren",
      data: { id: "containers", when: () => true, valueKey },
    });
    port.emit("ready");
    const plugin = await started;
    expect(dataRowsFor("gizmo")).toEqual({});

    const host = {
      id: 3,
      name: "h",
      ip: "1.2.3.4",
      password: "hunter2",
      pluginSettings: { gizmo: {} },
    };
    const view = render(
      <HostTreeChildren host={host as never}>
        {(groups) =>
          groups
            .flatMap((group) => group.result?.items ?? [])
            .map((item) => item.label)
            .join(",")
        }
      </HostTreeChildren>,
    );
    await act(flush);
    await waitFor(() =>
      expect(dataRowsFor("gizmo")).toEqual({
        [valueKey]: { "3": { hostId: 3 } },
      }),
    );

    await act(async () => {
      port.emit("value", {
        key: valueKey,
        value: {
          "3": {
            items: [
              { id: "a", label: "web", tabType: "gizmo" },
              { id: "b", label: "db", tabType: "gizmo" },
            ],
          },
        },
      });
      await flush();
    });
    await waitFor(() => expect(view.container.textContent).toBe("web,db"));

    view.unmount();
    await act(flush);
    expect(dataRowsFor("gizmo")).toEqual({});
    plugin.dispose();
  });
});

describe("data slots a frame owns", () => {
  afterEach(() => resetDataWatches());

  it("runs other plugins' hooks in the page and sends the frame their values", async () => {
    const events: { name: string; data: unknown }[] = [];
    const started = startFramedPlugin(summary);
    const { port } = await fakeFrame(
      () => undefined,
      (name, data) => events.push({ name, data }),
    );
    port.emit("register", {
      rid: "actionSlot#1",
      kind: "actionSlot",
      data: { id: "gizmo.rows", accepts: ["data"], rows: "host" },
    });
    port.emit("ready");
    const plugin = await started;
    setPermissionsForTesting([]);
    const opened = vi.fn();
    const sneaky = vi.fn();
    registerAction("metrics.open", opened, { pluginId: "metrics" });
    registerAction("other.wipe", sneaky, { pluginId: "other" });
    registerSlotContribution("gizmo.rows", {
      actionId: "metrics.row",
      titleKey: "row",
      kind: "data",
      pluginId: "metrics",
      value: dataReporter((context) => [
        { shape: "text", text: `seen ${String(context.hostId)}` },
        { shape: "badge", label: "Open", actionId: "metrics.open" },
      ]),
    });
    render(<DataWatchHost />);

    await expect(
      port.call("dataSlot.watch", [
        "w1",
        { slotId: "gizmo.rows", rowKey: "5", context: { hostId: 5 } },
      ]),
    ).resolves.toBe(true);
    // Only slots this plugin declared.
    await expect(
      port.call("dataSlot.watch", [
        "w2",
        { slotId: "dashboard.hostRow", rowKey: "5", context: {} },
      ]),
    ).resolves.toBe(false);
    await act(flush);
    const sent = events.filter((event) => event.name === "dataSlot").at(-1)
      ?.data as {
      id: string;
      values: { pluginId: string; parts: unknown[] }[];
    };
    expect(sent.id).toBe("w1");
    expect(sent.values[0].pluginId).toBe("metrics");
    expect(sent.values[0].parts[0]).toEqual({ shape: "text", text: "seen 5" });

    await port.call("dataSlot.action", ["w1", "metrics.open"]);
    await port.call("dataSlot.action", ["w1", "other.wipe"]);
    expect(opened).toHaveBeenCalledWith({ hostId: 5 });
    expect(sneaky).not.toHaveBeenCalled();

    plugin.dispose();
  });
});

describe("slot frame sizes", () => {
  it("sizes buttons and badges in a row to themselves", () => {
    for (const slot of [
      "credentials.rowActions",
      "credentials.badges",
      "hosts.selectionActions",
      "terminal.toolbar",
      "tab.inline",
    ]) {
      expect(slotFit(slot), slot).toBe("inline");
    }
    expect(slotFit("credentials.panel")).toBe("content");
    expect(slotFit("admin.userTabs")).toBe("fill");
  });
});

describe("background frame overlays", () => {
  async function started() {
    const startedPlugin = startFramedPlugin(summary);
    const { iframe, port } = await fakeFrame(() => undefined);
    port.emit("register", {
      rid: "action#1",
      kind: "action",
      data: { id: "gizmo.open", handler: () => "opened" },
    });
    port.emit("ready");
    const plugin = await startedPlugin;
    return { iframe, port, plugin };
  }
  const covers = (iframe: HTMLIFrameElement) =>
    (iframe.getAttribute("style") ?? "").includes("inset:0");

  it("can't cover the shell when nobody asked the plugin for anything", async () => {
    const { iframe, port, plugin } = await started();
    port.emit("overlay", { active: true });
    await flush();
    expect(covers(iframe)).toBe(false);
    plugin.dispose();
  });

  it("covers the shell for a dialog right after the user ran its action", async () => {
    const { iframe, port, plugin } = await started();
    await expect(invokeAction("gizmo.open")).resolves.toBe("opened");
    port.emit("overlay", { active: true });
    await flush();
    expect(covers(iframe)).toBe(true);
    port.emit("overlay", { active: false });
    await flush();
    expect(covers(iframe)).toBe(false);
    plugin.dispose();
  });

  it("does not count a call made without a click or key", async () => {
    const { iframe, port, plugin } = await started();
    Object.defineProperty(navigator, "userActivation", {
      value: { isActive: false },
      configurable: true,
    });
    try {
      await invokeAction("gizmo.open");
      port.emit("overlay", { active: true });
      await flush();
      expect(covers(iframe)).toBe(false);
    } finally {
      delete (navigator as { userActivation?: unknown }).userActivation;
      plugin.dispose();
    }
  });
});
