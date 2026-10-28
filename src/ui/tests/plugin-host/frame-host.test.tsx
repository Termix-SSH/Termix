import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { useHosts, useTabs } from "@termix-ssh/plugin-sdk/frontend";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  getSSHHosts: vi.fn(async () => [
    {
      id: 7,
      name: "web-01",
      ip: "10.0.0.7",
      port: 22,
      username: "root",
      pluginSettings: { gizmo: { enableGizmo: true } },
    },
  ]),
}));

import {
  startPluginFrame,
  type FrameShell,
  type PluginFrame,
} from "@/plugin-host/frame-host";
import { resetPluginStore } from "@/plugin-host/plugin-store";
import { resetTabTypes } from "@/shell/tab-registry";

const summary: PluginSummary = {
  id: "gizmo",
  name: "Gizmo",
  version: "1.0.0",
  enabled: true,
  state: "active",
  frontend: true,
  contributes: {
    tabs: [
      {
        id: "gizmo-home",
        titleKey: "nav.home",
        icon: "Box",
        openFrom: ["rail"],
      },
      {
        id: "gizmo-host",
        titleKey: "nav.host",
        icon: "Server",
        openFrom: ["host-context-menu"],
      },
    ],
  },
};

function Home() {
  const { hosts } = useHosts();
  const tabs = useTabs();
  return (
    <div>
      <p>hosts: {hosts.map((host) => host.name).join(",")}</p>
      <button onClick={() => tabs.connectHost(hosts[0] as never)}>
        connect
      </button>
      <button onClick={() => tabs.openTab(hosts[0] as never, "gizmo-host")}>
        open
      </button>
    </div>
  );
}

function HostView({
  host,
  sshHost,
}: {
  host?: { name: string };
  sshHost?: { pluginSettings?: { gizmo?: { enableGizmo?: boolean } } };
}) {
  const on = sshHost?.pluginSettings?.gizmo?.enableGizmo === true;
  return (
    <p>
      host view: {host?.name ?? "none"} {on ? "on" : "off"}
    </p>
  );
}

const module = {
  activate: (app: {
    registerTab: (type: string, component: unknown, options?: object) => void;
  }) => {
    app.registerTab("gizmo-home", Home, { hostless: true });
    app.registerTab("gizmo-host", HostView, { requiresHost: true });
  },
  deactivate: vi.fn(),
};

function makeShell(): FrameShell & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    openTab: record("openTab"),
    openSingletonTab: record("openSingletonTab"),
    connectHost: record("connectHost"),
    closeTab: record("closeTab"),
    renameTab: record("renameTab"),
  };
}

let root: HTMLElement;
let frame: PluginFrame | null = null;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(async () => {
  if (frame) await act(() => frame!.dispose());
  frame = null;
  root.remove();
  resetPluginStore();
  resetTabTypes();
});

describe("startPluginFrame", () => {
  it("renders the chosen view with the server's hosts", async () => {
    const shell = makeShell();
    frame = await act(() =>
      startPluginFrame({
        root,
        summary,
        module: module as never,
        view: { view: "gizmo-home" },
        theme: { id: "dracula", mode: "dark" },
        shell,
      }),
    );
    await waitFor(() => expect(screen.getByText("hosts: web-01")).toBeTruthy());
    expect(document.documentElement.classList.contains("dracula")).toBe(true);
    expect(frame.views()).toEqual({
      tabs: ["gizmo-home", "gizmo-host"],
      panels: [],
    });
  });

  it("passes shell calls to the embedder by host id", async () => {
    const shell = makeShell();
    frame = await act(() =>
      startPluginFrame({
        root,
        summary,
        module: module as never,
        view: { view: "gizmo-home" },
        theme: { id: "light", mode: "light" },
        shell,
      }),
    );
    await waitFor(() => screen.getByText("hosts: web-01"));
    act(() => screen.getByText("connect").click());
    act(() => screen.getByText("open").click());
    expect(shell.calls).toEqual([
      ["connectHost", "7", undefined],
      ["openTab", "7", "gizmo-host", { label: undefined, data: undefined }],
    ]);
  });

  it("switches views and themes, and deactivates on dispose", async () => {
    frame = await act(() =>
      startPluginFrame({
        root,
        summary,
        module: module as never,
        view: { view: "gizmo-host", hostId: "7" },
        theme: { id: "dark", mode: "dark" },
        shell: makeShell(),
      }),
    );
    await waitFor(() => screen.getByText("host view: web-01 on"));
    act(() => frame!.setView({ view: "gizmo-home" }));
    await waitFor(() => screen.getByText("hosts: web-01"));
    act(() => frame!.setTheme({ id: "nord", mode: "dark" }));
    await waitFor(() =>
      expect(document.documentElement.classList.contains("nord")).toBe(true),
    );
    await act(() => frame!.dispose());
    frame = null;
    expect(module.deactivate).toHaveBeenCalled();
    expect(root.textContent).toBe("");
  });
});
