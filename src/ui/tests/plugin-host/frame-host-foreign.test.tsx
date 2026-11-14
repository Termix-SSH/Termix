import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { useExtensions } from "@termix-ssh/plugin-sdk/frontend";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  getSSHHosts: vi.fn(async () => []),
}));

import {
  PART_VIEW,
  PROBE_VIEW,
  startPluginFrame,
  type PluginFrame,
} from "@/plugin-host/frame-host";
import { resetPluginStore } from "@/plugin-host/plugin-store";
import { resetTabTypes } from "@/shell/tab-registry";
import { resetExtensions } from "@/plugin-host/extension-registry";

const summary = (id: string, tabs: string[] = []): PluginSummary =>
  ({
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    contributes: {
      tabs: tabs.map((tab) => ({ id: tab, titleKey: tab, icon: "Box" })),
    },
  }) as unknown as PluginSummary;

const shell = {
  openTab: vi.fn(),
  openSingletonTab: vi.fn(),
  connectHost: vi.fn(),
  closeTab: vi.fn(),
  renameTab: vi.fn(),
};

function DockerWidget(props: Record<string, unknown>) {
  return <p>docker widget {String(props.title ?? "")}</p>;
}

const docker = {
  activate: (app: {
    registerExtension: (point: string, item: object) => void;
  }) => {
    app.registerExtension("homepage.widgets", {
      id: "docker",
      name: "Docker",
      load: () => 1,
      components: { view: DockerWidget },
    });
  },
};

function Clock() {
  return <p>clock</p>;
}

function Board() {
  const widgets = useExtensions("homepage.widgets");
  return (
    <div>
      <p>widgets: {widgets.map((widget) => widget.id).join(",")}</p>
      {widgets.map((widget) => {
        const View = widget.components!.view;
        return <View key={widget.id} title="hi" />;
      })}
    </div>
  );
}

const homepage = {
  activate: (app: {
    registerTab: (type: string, component: unknown, options?: object) => void;
    registerExtension: (point: string, item: object) => void;
  }) => {
    app.registerTab("homepage", Board, { hostless: true });
    app.registerExtension("homepage.widgets", {
      id: "clock",
      name: "Clock",
      components: { view: Clock },
    });
  },
};

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
  resetExtensions();
});

describe("other plugins' parts in a single plugin page", () => {
  it("a probe lists the plugin's own parts as plain data", async () => {
    frame = await act(() =>
      startPluginFrame({
        root,
        summary: summary("docker"),
        module: docker as never,
        view: { view: PROBE_VIEW },
        theme: { id: "dark", mode: "dark" },
        shell,
      }),
    );
    const { items } = frame.describeParts("extension", "homepage.widgets");
    expect(items).toEqual([
      {
        id: "docker",
        name: "Docker",
        pluginId: "docker",
        key: "docker",
        components: { view: { $foreign: "docker\u0000view" } },
      },
    ]);
    expect(frame.describeParts("component", "terminal.view").items).toEqual([]);
    expect(root.textContent).toBe("");
  });

  it("a part view draws one part with the props it was given", async () => {
    const sizes: unknown[] = [];
    frame = await act(() =>
      startPluginFrame({
        root,
        summary: summary("docker"),
        module: docker as never,
        view: {
          view: PART_VIEW,
          data: {
            kind: "extension",
            id: "homepage.widgets",
            itemKey: "docker\u0000view",
            props: { title: "web" },
          },
        },
        theme: { id: "dark", mode: "dark" },
        shell,
        onPartSize: (size) => sizes.push(size),
      }),
    );
    await waitFor(() => screen.getByText("docker widget web"));
    expect(sizes.length).toBeGreaterThan(0);
    act(() =>
      frame!.setView({
        view: PART_VIEW,
        data: {
          kind: "extension",
          id: "homepage.widgets",
          itemKey: "docker\u0000view",
          props: { title: "db" },
        },
      }),
    );
    await waitFor(() => screen.getByText("docker widget db"));
  });

  it("a consumer page merges its own parts with the embedder's", async () => {
    const calls: Array<[string, unknown[]]> = [];
    frame = await act(() =>
      startPluginFrame({
        root,
        summary: summary("homepage", ["homepage"]),
        module: homepage as never,
        view: { view: "homepage" },
        theme: { id: "dark", mode: "dark" },
        shell,
        foreign: {
          call: async (method, args) => {
            calls.push([method, args]);
            return true;
          },
          emit: vi.fn(),
        },
      }),
    );
    await waitFor(() => screen.getByText("widgets: clock"));
    const list = calls.find(([method]) => method === "foreign.list")!;
    expect(list[1].slice(1, 3)).toEqual(["extension", "homepage.widgets"]);
    act(() => {
      frame!.foreignEvent("foreign.items", {
        listId: list[1][0],
        items: [
          {
            key: "docker",
            id: "docker",
            name: "Docker",
            components: { view: { $foreign: "docker\u0000view" } },
          },
        ],
      });
    });
    await waitFor(() => screen.getByText("widgets: clock,docker"));
    // Own widget draws itself; the other one is a placeholder.
    expect(screen.getByText("clock")).toBeTruthy();
    expect(root.querySelector("[data-foreign-slot]")).not.toBeNull();
  });
});
