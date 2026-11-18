import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    permissions: [],
    isAdmin: true,
    loaded: true,
    has: () => true,
  }),
}));

import {
  ForeignViewHost,
  addForeignList,
  disposeForeignView,
  dropForeignConsumer,
  foreignAllowsAction,
  foreignStateFor,
  mountForeignView,
  placeForeignViews,
  removeForeignList,
  resetForeignViews,
  runForeignPlacement,
  setForeignProps,
  type ForeignConsumerRef,
} from "@/plugin-host/frames/foreign-views";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import {
  declareActionSlot,
  registerSlotContribution,
  resetActionRegistry,
} from "@/shell/action-registry";
import {
  registerExtension,
  resetExtensions,
} from "@/plugin-host/extension-registry";
import { setSharedState } from "@/plugin-host/frames/frame-state";
import { setForeignAnchor } from "@/plugin-host/frames/foreign-anchors";

const summary = (id: string, uses: string[] = []): PluginSummary =>
  ({
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    contributes: { uses },
  }) as unknown as PluginSummary;

const seen: Array<Record<string, unknown>> = [];

function Card(props: Record<string, unknown>) {
  seen.push(props);
  return <div data-testid="card">{String(props.label ?? "")}</div>;
}

function Widget() {
  return <div data-testid="widget">widget</div>;
}

let iframe: HTMLIFrameElement;
let events: Array<[string, unknown]>;
let frameRect = { left: 100, top: 50, width: 800, height: 600 };

function consumer(owner = "c1", pluginId = "host-metrics"): ForeignConsumerRef {
  return {
    owner,
    pluginId,
    iframe,
    emit: (name, data) => events.push([name, data]),
  };
}

function itemsFor(listId: string) {
  const last = [...events]
    .reverse()
    .find(
      ([name, data]) =>
        name === "foreign.items" &&
        (data as { listId: string }).listId === listId,
    );
  return (last?.[1] as { items: Record<string, unknown>[] } | undefined)?.items;
}

function layerViews() {
  return [...document.querySelectorAll<HTMLDivElement>("[data-foreign-view]")];
}

beforeEach(() => {
  seen.length = 0;
  events = [];
  frameRect = { left: 100, top: 50, width: 800, height: 600 };
  resetPluginStore();
  setPluginSummaries([
    summary("host-metrics"),
    summary("homepage"),
    summary("cron"),
    summary("docker"),
  ]);
  declareActionSlot({
    id: "host-metrics.managers",
    accepts: ["component", "button"],
    pluginId: "host-metrics",
    fit: "content",
  });
  registerSlotContribution("host-metrics.managers", {
    actionId: "cron.card",
    titleKey: "cron.title",
    kind: "component",
    component: Card,
    pluginId: "cron",
  });
  registerSlotContribution("host-metrics.managers", {
    actionId: "cron.open",
    titleKey: "cron.open",
    kind: "button",
    pluginId: "cron",
  });
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.getBoundingClientRect = () =>
    ({
      ...frameRect,
      x: frameRect.left,
      y: frameRect.top,
      right: frameRect.left + frameRect.width,
      bottom: frameRect.top + frameRect.height,
      toJSON: () => ({}),
    }) as DOMRect;
});

afterEach(() => {
  resetForeignViews();
  resetActionRegistry();
  resetExtensions();
  resetPluginStore();
  iframe.remove();
  document.getElementById("termix-foreign-views")?.remove();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountCard(props: Record<string, unknown> = { label: "hi" }) {
  render(<ForeignViewHost />);
  let listed = false;
  act(() => {
    listed = addForeignList(
      consumer(),
      "l1",
      "slot",
      "host-metrics.managers",
      {},
    );
  });
  expect(listed).toBe(true);
  await flush();
  let mounted = false;
  act(() => {
    mounted = mountForeignView("c1", {
      id: "v1",
      listId: "l1",
      itemKey: "cron.card",
      props,
    });
  });
  expect(mounted).toBe(true);
  await flush();
}

describe("layers next to their frame", () => {
  let box: HTMLDivElement;
  let anchor: HTMLDivElement;

  beforeEach(() => {
    box = document.createElement("div");
    anchor = document.createElement("div");
    iframe.remove();
    box.append(iframe, anchor);
    document.body.appendChild(box);
    setForeignAnchor(iframe, anchor);
    // The shell sizes a shell scrolled frame to its whole page.
    frameRect = { ...frameRect, height: 2000 };
  });

  afterEach(() => {
    setForeignAnchor(iframe, null);
    box.remove();
  });

  function place(y: number) {
    placeForeignViews("c1", {
      views: [
        {
          id: "v1",
          rect: { x: 20, y, width: 200, height: 100 },
          clip: null,
          visible: true,
          interactive: true,
          z: 0,
        },
      ],
    });
    runForeignPlacement();
  }

  it("draws in the anchor, in the frame's own coords", async () => {
    await mountCard();
    place(900);
    const [view] = layerViews();
    expect(anchor.contains(view)).toBe(true);
    expect(view.style.left).toBe("20px");
    expect(view.style.top).toBe("900px");
    // Below the frame's old viewport, but the frame is that tall now.
    expect(view.style.visibility).toBe("visible");
    expect(view.parentElement!.style.position).toBe("absolute");
  });

  it("stays put when the page scrolls, with nothing to measure", async () => {
    await mountCard();
    place(300);
    const [view] = layerViews();
    frameRect = { ...frameRect, top: -400 };
    runForeignPlacement();
    expect(view.style.top).toBe("300px");
  });
});

describe("foreign views in the shell", () => {
  it("sends a slot's parts as plain data with markers for components", async () => {
    render(<ForeignViewHost />);
    addForeignList(consumer(), "l1", "slot", "host-metrics.managers", {});
    await flush();
    const items = itemsFor("l1")!;
    expect(items.map((item) => item.key)).toEqual(["cron.card", "cron.open"]);
    expect(items[0]).toMatchObject({
      actionId: "cron.card",
      kind: "component",
      fit: "content",
      component: { $foreign: "cron.card" },
    });
    expect(items[1].component).toBeUndefined();
    // Nothing that is a function or a DOM node goes to the consumer.
    const json = JSON.stringify(events);
    expect(json).not.toContain("function");
    for (const [, data] of events) {
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    }
  });

  it("refuses lists the consumer may not read", () => {
    render(<ForeignViewHost />);
    expect(
      addForeignList(
        consumer("c2", "homepage"),
        "l1",
        "slot",
        "host-metrics.managers",
        {},
      ),
    ).toBe(false);
    expect(
      addForeignList(consumer(), "l2", "extension", "homepage.widgets", {}),
    ).toBe(false);
    expect(addForeignList(consumer(), "x".repeat(50), "slot", "a", {})).toBe(
      false,
    );
  });

  it("lets the consumer run only buttons it listed", async () => {
    render(<ForeignViewHost />);
    addForeignList(consumer(), "l1", "slot", "host-metrics.managers", {});
    await flush();
    expect(foreignAllowsAction("c1", "cron.open")).toBe(true);
    expect(foreignAllowsAction("c1", "cron.card")).toBe(false);
    expect(foreignAllowsAction("c1", "docker.remove")).toBe(false);
    expect(foreignAllowsAction("c2", "cron.open")).toBe(false);
  });

  it("draws the provider's part in a layer at the placeholder", async () => {
    await mountCard();
    const [view] = layerViews();
    expect(view.textContent).toBe("hi");
    placeForeignViews("c1", {
      views: [
        {
          id: "v1",
          rect: { x: 20, y: 30, width: 200, height: 100 },
          clip: null,
          visible: true,
          interactive: true,
          z: 0,
        },
      ],
    });
    runForeignPlacement();
    expect(view.style.left).toBe("20px");
    expect(view.style.top).toBe("30px");
    expect(view.style.width).toBe("200px");
    expect(view.style.visibility).toBe("visible");
    // A part never paints over the parts next to it.
    expect(view.style.overflow).toBe("hidden");
    const layer = view.parentElement!;
    expect(layer.style.left).toBe("100px");
    expect(layer.style.top).toBe("50px");
    expect(layer.style.overflow).toBe("hidden");
  });

  it("says an in-page part is shown once it mounts", async () => {
    await mountCard();
    expect(events).toContainEqual(["foreign.shown", { id: "v1" }]);
  });

  it("keeps the same view while the placeholder moves", async () => {
    await mountCard();
    const [view] = layerViews();
    for (let y = 0; y < 300; y += 50) {
      placeForeignViews("c1", {
        views: [
          {
            id: "v1",
            rect: { x: 0, y, width: 200, height: 100 },
            clip: null,
            visible: true,
          },
        ],
      });
      runForeignPlacement();
      expect(layerViews()[0]).toBe(view);
      expect(view.style.top).toBe(`${y}px`);
    }
    // New props redraw it in place.
    setForeignProps("c1", "v1", { label: "next" });
    await flush();
    expect(layerViews()[0]).toBe(view);
    expect(view.textContent).toBe("next");
  });

  it("follows the consumer frame when the shell moves it", async () => {
    await mountCard();
    placeForeignViews("c1", {
      views: [
        {
          id: "v1",
          rect: { x: 0, y: 0, width: 10, height: 10 },
          clip: null,
          visible: true,
        },
      ],
    });
    runForeignPlacement();
    frameRect = { left: 300, top: 70, width: 800, height: 600 };
    runForeignPlacement();
    const layer = layerViews()[0].parentElement!;
    expect(layer.style.left).toBe("300px");
    expect(layer.style.top).toBe("70px");
  });

  it("hides views under an open menu and while the frame is hidden", async () => {
    await mountCard();
    const place = () =>
      placeForeignViews("c1", {
        views: [
          {
            id: "v1",
            rect: { x: 0, y: 0, width: 200, height: 100 },
            clip: null,
            visible: true,
          },
        ],
      });
    place();
    runForeignPlacement();
    const [view] = layerViews();
    expect(view.style.visibility).toBe("visible");
    placeForeignViews("c1", {
      views: [
        {
          id: "v1",
          rect: { x: 0, y: 0, width: 200, height: 100 },
          clip: null,
          visible: true,
          covers: [{ x: 50, y: 50, width: 100, height: 100 }],
        },
      ],
    });
    expect(view.style.visibility).toBe("hidden");
    expect(view.style.pointerEvents).toBe("none");
    place();
    expect(view.style.visibility).toBe("visible");
    // A tab in the back: the frame has no box.
    frameRect = { left: 0, top: 0, width: 0, height: 0 };
    runForeignPlacement();
    expect(view.parentElement!.style.display).toBe("none");
  });

  it("lets clicks through while the consumer edits or drags", async () => {
    await mountCard();
    placeForeignViews("c1", {
      views: [
        {
          id: "v1",
          rect: { x: 0, y: 0, width: 200, height: 100 },
          clip: null,
          visible: true,
          interactive: false,
        },
      ],
    });
    runForeignPlacement();
    const [view] = layerViews();
    expect(view.style.pointerEvents).toBe("none");
    placeForeignViews("c1", {
      views: [
        {
          id: "v1",
          rect: { x: 0, y: 0, width: 200, height: 101 },
          clip: null,
          visible: true,
          interactive: true,
        },
      ],
    });
    expect(view.style.pointerEvents).toBe("auto");
    placeForeignViews("c1", { dragging: true });
    expect(view.style.pointerEvents).toBe("none");
  });

  it("disposes a view, a list and a closed consumer", async () => {
    await mountCard();
    expect(layerViews()).toHaveLength(1);
    disposeForeignView("c1", "v1");
    await flush();
    expect(layerViews()).toHaveLength(0);
    mountForeignView("c1", {
      id: "v2",
      listId: "l1",
      itemKey: "cron.card",
      props: {},
    });
    await flush();
    expect(layerViews()).toHaveLength(1);
    removeForeignList("c1", "l1");
    await flush();
    expect(layerViews()).toHaveLength(0);
    expect(foreignStateFor("c1")?.lists).toEqual([]);
    dropForeignConsumer("c1");
    await flush();
    expect(foreignStateFor("c1")).toBeUndefined();
  });

  it("drops a view when its part goes away", async () => {
    await mountCard();
    resetActionRegistry();
    await flush();
    expect(layerViews()).toHaveLength(0);
  });

  it("gives the provider the shell's host as the provider sees it", async () => {
    setSharedState({
      shellHosts: [
        {
          id: 9,
          name: "box",
          ip: "10.0.0.9",
          pluginSettings: { cron: { a: 1 }, "host-metrics": { secret: 2 } },
        },
      ],
    });
    await mountCard({
      label: "x",
      host: { id: 9, pluginSettings: { "host-metrics": { secret: 2 } } },
    });
    const props = seen[seen.length - 1];
    const host = props.host as { pluginSettings: Record<string, unknown> };
    expect(host.pluginSettings).toEqual({ cron: { a: 1 } });
    setSharedState({ shellHosts: [] });
  });

  it("sends extension items without the consumer's own", async () => {
    registerExtension("homepage.widgets", {
      id: "docker",
      pluginId: "docker",
      name: "Docker",
      defaultSize: { w: 2, h: 2 },
      load: () => 1,
      components: { view: Widget, editForm: Widget },
    });
    registerExtension("homepage.widgets", {
      id: "clock",
      pluginId: "homepage",
      components: { view: Widget },
    });
    render(<ForeignViewHost />);
    addForeignList(
      consumer("c3", "homepage"),
      "l1",
      "extension",
      "homepage.widgets",
      {},
    );
    await flush();
    const items = itemsFor("l1")!;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "docker",
      name: "Docker",
      defaultSize: { w: 2, h: 2 },
      components: {
        view: { $foreign: "docker\u0000view" },
        editForm: { $foreign: "docker\u0000editForm" },
      },
    });
    // Functions never cross.
    expect(items[0].load).toBeUndefined();
  });
});

describe("a consumer that tries to reach the provider", () => {
  it("can't mount a view for a list it does not own", async () => {
    await mountCard();
    render(<ForeignViewHost />);
    addForeignList(
      consumer("c2", "homepage"),
      "own",
      "extension",
      "homepage.widgets",
      {},
    );
    await flush();
    // Another consumer's list id, an unknown part, a bad id.
    expect(
      mountForeignView("c2", {
        id: "v9",
        listId: "l1",
        itemKey: "cron.card",
        props: {},
      }),
    ).toBe(false);
    expect(
      mountForeignView("c1", {
        id: "v9",
        listId: "l1",
        itemKey: "docker.secret",
        props: {},
      }),
    ).toBe(false);
    expect(
      mountForeignView("c1", {
        id: { toString: () => "v1" },
        listId: "l1",
        itemKey: "cron.card",
      }),
    ).toBe(false);
    // Re-pointing an existing view at another part is refused.
    expect(
      mountForeignView("c1", {
        id: "v1",
        listId: "l1",
        itemKey: "cron.open",
        props: {},
      }),
    ).toBe(false);
  });

  it("can't move or dispose another consumer's views", async () => {
    await mountCard();
    const [view] = layerViews();
    placeForeignViews("c2", {
      views: [
        {
          id: "v1",
          rect: { x: -500, y: -500, width: 5000, height: 5000 },
          visible: true,
        },
      ],
    });
    disposeForeignView("c2", "v1");
    await flush();
    expect(layerViews()[0]).toBe(view);
    expect(view.style.left).not.toBe("-500px");
  });

  it("only ever hears about its own placeholder ids", async () => {
    await mountCard();
    for (const [name, data] of events) {
      expect(name.startsWith("foreign.")).toBe(true);
      expect(Object.keys(data as object).sort()).toEqual(
        name === "foreign.items" ? ["items", "listId", "strings"] : ["id"],
      );
    }
  });
});
