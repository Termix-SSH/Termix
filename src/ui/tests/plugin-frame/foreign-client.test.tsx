import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { ComponentType } from "react";
import {
  createForeignRuntime,
  focusPast,
  receiveForeignEvent,
  resetForeignClient,
} from "@/plugin-frame/foreign-client";
import {
  getForeignRuntime,
  setForeignRuntime,
  type ForeignRuntime,
} from "@/components/foreign/foreign-runtime";
import {
  ForeignInteractive,
  ForeignSlot,
  useForeignOccluder,
} from "@/components/foreign/ForeignSlot";
import { ComponentSlot } from "@/shell/ActionSlot";

type AnyComponent = ComponentType<Record<string, unknown>>;

let calls: Array<[string, unknown[]]>;
let emitted: Array<[string, unknown]>;
let runtime: ForeignRuntime;
let answer: (method: string, args: unknown[]) => unknown;

beforeEach(() => {
  calls = [];
  emitted = [];
  answer = () => true;
  runtime = createForeignRuntime({
    call: async (method, ...args) => {
      calls.push([method, args]);
      return answer(method, args);
    },
    emit: (name, data) => emitted.push([name, data]),
  });
  setForeignRuntime(runtime);
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  setForeignRuntime(null);
  resetForeignClient();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function listId(kind: string, id: string) {
  const call = calls.find(
    ([method, args]) =>
      method === "foreign.list" && args[1] === kind && args[2] === id,
  );
  return call?.[1][0] as string;
}

describe("other plugins' parts inside a frame", () => {
  it("asks the shell for a slot and turns its parts into placeholders", async () => {
    const { result } = renderHook(() =>
      runtime.useSlot("host-metrics.managers", {
        host: { id: 4, secret: "x" },
      }),
    );
    expect(result.current).toEqual([]);
    const id = listId("slot", "host-metrics.managers");
    // The host crosses as its id only.
    expect(calls[0][1][3]).toEqual({ hostId: 4 });
    act(() => {
      receiveForeignEvent("foreign.items", {
        listId: id,
        items: [
          {
            key: "cron.card",
            actionId: "cron.card",
            titleKey: "cron:card.title",
            kind: "component",
            fit: "content",
            pluginId: "cron",
            icon: { $icon: "Clock" },
            component: { $foreign: "cron.card" },
          },
          {
            key: "cron.open",
            actionId: "cron.open",
            titleKey: "cron:open",
            kind: "button",
          },
        ],
        strings: { "cron:card.title": "Cron jobs" },
      });
    });
    expect(result.current).toHaveLength(2);
    expect(result.current[0].component).toBeTypeOf("function");
    expect(result.current[0].icon).toBeTruthy();
    expect(result.current[1].component).toBeUndefined();
    const before = result.current[0].component;
    act(() => {
      receiveForeignEvent("foreign.items", {
        listId: id,
        items: [
          {
            key: "cron.card",
            actionId: "cron.card",
            kind: "component",
            fit: "content",
            component: { $foreign: "cron.card" },
          },
        ],
      });
    });
    // The same part keeps its component, so views never remount.
    expect(result.current[0].component).toBe(before);
  });

  it("mounts a placeholder, sends props changes and disposes it", async () => {
    const { result } = renderHook(() => runtime.useSlot("a.slot"));
    act(() => {
      receiveForeignEvent("foreign.items", {
        listId: listId("slot", "a.slot"),
        items: [
          {
            key: "p.part",
            actionId: "p.part",
            kind: "component",
            fit: "content",
            component: { $foreign: "p.part" },
          },
        ],
      });
    });
    const Part = result.current[0].component as AnyComponent;
    const view = render(<Part label="one" onPick={() => 1} />);
    await settle();
    const mount = calls.find(([method]) => method === "foreign.mount")!;
    const sent = mount[1][0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      listId: listId("slot", "a.slot"),
      itemKey: "p.part",
      props: { label: "one" },
    });
    expect(typeof (sent.props as { onPick: unknown }).onPick).toBe("function");
    const placeholder = view.container.querySelector<HTMLElement>(
      "[data-foreign-slot]",
    )!;
    // Content fit: no height until the provider says how tall it is.
    expect(placeholder.style.height).toBe("0px");
    act(() => {
      receiveForeignEvent("foreign.size", {
        id: sent.id,
        size: { width: 300, height: 120 },
      });
    });
    expect(placeholder.style.height).toBe("120px");
    expect(placeholder.hasAttribute("data-foreign-shown")).toBe(false);
    act(() => {
      receiveForeignEvent("foreign.shown", { id: sent.id });
    });
    expect(placeholder.hasAttribute("data-foreign-shown")).toBe(true);
    // A new function each render is not a change.
    view.rerender(<Part label="one" onPick={() => 2} />);
    await settle();
    expect(emitted.filter(([name]) => name === "foreign.props")).toHaveLength(
      0,
    );
    view.rerender(<Part label="two" onPick={() => 2} />);
    await settle();
    expect(
      emitted.find(([name]) => name === "foreign.props")?.[1],
    ).toMatchObject({ id: sent.id, props: { label: "two" } });
    view.unmount();
    expect(emitted.find(([name]) => name === "foreign.dispose")?.[1]).toEqual({
      id: sent.id,
    });
  });

  it("draws nothing when the shell refuses the list", async () => {
    answer = (method) => method !== "foreign.list";
    const { result } = renderHook(() => runtime.useSlot("not.mine"));
    await settle();
    expect(result.current).toEqual([]);
  });

  it("merges the shell's extension items and finds them by id", async () => {
    const { result } = renderHook(() =>
      runtime.useExtensions("homepage.widgets"),
    );
    act(() => {
      receiveForeignEvent("foreign.items", {
        listId: listId("extension", "homepage.widgets"),
        items: [
          {
            key: "docker",
            id: "docker",
            name: "Docker",
            icon: { $icon: "Container", element: true },
            components: {
              view: { $foreign: "docker\u0000view" },
              editForm: { $foreign: "docker\u0000editForm" },
            },
          },
        ],
      });
    });
    const [item] = result.current;
    expect(item.id).toBe("docker");
    expect(item.name).toBe("Docker");
    expect(
      Object.keys(item.components as Record<string, unknown>).sort(),
    ).toEqual(["editForm", "view"]);
    expect(runtime.getExtension("homepage.widgets", "docker")).toBe(item);
    expect(runtime.getExtension("homepage.widgets", "nope")).toBeUndefined();
  });

  it("hands focus to the shell and moves past on the way out", async () => {
    // jsdom lays nothing out; every element counts as shown here.
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    const { result } = renderHook(() => runtime.useComponent("terminal.view"));
    act(() => {
      receiveForeignEvent("foreign.items", {
        listId: listId("component", "terminal.view"),
        items: [
          {
            key: "component",
            fit: "fill",
            component: { $foreign: "component" },
          },
        ],
      });
    });
    const Terminal = result.current as AnyComponent;
    const view = render(
      <div>
        <button>before</button>
        <Terminal />
        <button>after</button>
      </div>,
    );
    await settle();
    const placeholder = view.container.querySelector<HTMLElement>(
      "[data-foreign-slot]",
    )!;
    expect(placeholder.tabIndex).toBe(0);
    const before = view.getByText("before");
    before.focus();
    act(() => placeholder.focus());
    const focus = calls.find(([method]) => method === "foreign.focus")!;
    expect(focus[1][1]).toBe("first");
    const mounted = calls.find(([method]) => method === "foreign.mount")!;
    const id = (mounted[1][0] as { id: string }).id;
    act(() => {
      receiveForeignEvent("foreign.focusOut", { id, dir: "next" });
    });
    expect(document.activeElement).toBe(view.getByText("after"));
    focusPast(placeholder, "prev");
    expect(document.activeElement).toBe(before);
  });

  it("makes placeholders inert inside an edit mode", async () => {
    const { result } = renderHook(() => runtime.useComponent("x.view"));
    act(() => {
      receiveForeignEvent("foreign.items", {
        listId: listId("component", "x.view"),
        items: [
          {
            key: "component",
            fit: "fill",
            component: { $foreign: "component" },
          },
        ],
      });
    });
    const View = result.current as AnyComponent;
    const view = render(
      <ForeignInteractive interactive={false}>
        <View />
      </ForeignInteractive>,
    );
    await settle();
    expect(
      view.container.querySelector<HTMLElement>("[data-foreign-slot]")!
        .tabIndex,
    ).toBe(-1);
  });

  it("ignores events for ids it never made", () => {
    expect(receiveForeignEvent("foreign.size", { id: "v999" })).toBe(true);
    expect(receiveForeignEvent("foreign.items", { listId: "l999" })).toBe(true);
    expect(receiveForeignEvent("state", {})).toBe(false);
  });

  it("routes ComponentSlot through the shell inside a frame", async () => {
    render(<ComponentSlot slotId="terminal.overlay" props={{ a: 1 }} />);
    expect(listId("slot", "terminal.overlay")).toBeTruthy();
  });
});

describe("in the page", () => {
  beforeEach(() => setForeignRuntime(null));

  it("ForeignSlot renders the component itself", () => {
    expect(getForeignRuntime()).toBeNull();
    const Plain = (props: Record<string, unknown>) => (
      <span>{String(props.label)}</span>
    );
    const view = render(<ForeignSlot of={Plain} props={{ label: "hi" }} />);
    expect(view.container.textContent).toBe("hi");
    expect(view.container.querySelector("[data-foreign-slot]")).toBeNull();
  });

  it("useForeignOccluder only passes the ref on", () => {
    const seen: Array<Element | null> = [];
    function Box() {
      const ref = useForeignOccluder<HTMLDivElement>((node) => {
        seen.push(node);
      });
      return <div ref={ref} />;
    }
    render(<Box />);
    expect(seen[0]).toBeInstanceOf(HTMLDivElement);
  });
});
