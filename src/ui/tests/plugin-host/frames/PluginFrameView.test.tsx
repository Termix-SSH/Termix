import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { Suspense } from "react";

type Options = {
  getProps: () => Record<string, unknown>;
  onReady: () => void;
  onEvent: (name: string, data: unknown) => void;
};

const frames = vi.hoisted(() => ({
  options: null as Options | null,
  emitted: [] as Array<[string, unknown]>,
  closed: 0,
  connects: 0,
}));

vi.mock("@/plugin-host/frames/frame-connection", () => ({
  frameUrl: (id: string, params: Record<string, string | undefined>) =>
    `/plugin-assets/${id}/_frame/?${new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [
        string,
        string,
      ][],
    )}`,
  connectFrame: (
    _el: HTMLIFrameElement,
    _id: string,
    _role: string,
    _key: string,
    options: Options,
  ) => {
    frames.options = options;
    frames.connects++;
    return {
      port: {
        emit: (name: string, data: unknown) =>
          frames.emitted.push([name, data]),
      },
      close: () => {
        frames.closed++;
      },
    };
  },
}));
vi.mock("@/plugin-host/plugin-store", () => ({
  usePluginStore: () => ({
    records: new Map([["docker", { summary: { assetVersion: "7" } }]]),
  }),
}));

const { PluginFrameView, SANDBOX } =
  await import("@/plugin-host/frames/PluginFrameView");

beforeEach(() => {
  frames.options = null;
  frames.emitted = [];
  frames.closed = 0;
  frames.connects = 0;
});

let pending: Promise<void> | null = null;
function MaySuspend() {
  if (pending) throw pending;
  return null;
}

describe("PluginFrameView", () => {
  it("keeps a ready frame's connection when Suspense hides and shows it again", async () => {
    const view = (hostId: number) => (
      <Suspense fallback={<p>loading</p>}>
        <PluginFrameView
          pluginId="docker"
          frameKey="main"
          fit="fill"
          props={{ hostId }}
        />
        <MaySuspend />
      </Suspense>
    );
    const { rerender } = render(view(1));
    act(() => frames.options!.onReady());
    expect(frames.emitted).toHaveLength(1);

    let resume: () => void = () => {};
    pending = new Promise<void>((resolve) => {
      resume = resolve;
    });
    rerender(view(1));
    pending = null;
    await act(async () => resume());
    rerender(view(2));

    expect(frames.connects).toBe(1);
    expect(frames.closed).toBe(0);
    // Still ready, so the new props go over without a second hello.
    expect(frames.emitted).toHaveLength(2);
  });

  it("closes a kept connection once a hidden frame leaves the page", async () => {
    vi.useFakeTimers();
    try {
      const view = () => (
        <Suspense fallback={<p>loading</p>}>
          <PluginFrameView
            pluginId="docker"
            frameKey="main"
            fit="fill"
            props={{}}
          />
          <MaySuspend />
        </Suspense>
      );
      const { rerender, unmount } = render(view());
      pending = new Promise<void>(() => {});
      rerender(view());
      await act(async () => {});
      expect(frames.closed).toBe(0);
      unmount();
      pending = null;
      vi.advanceTimersByTime(1500);
      expect(frames.closed).toBe(1);
    } finally {
      pending = null;
      vi.useRealTimers();
    }
  });

  it("loads a script only sandboxed frame from the plugin's own folder", () => {
    const { container } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="main"
        fit="fill"
        props={{}}
      />,
    );
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("sandbox")).toBe(SANDBOX);
    expect(SANDBOX).toBe("allow-scripts");
    expect(iframe.getAttribute("src")).toContain(
      "/plugin-assets/docker/_frame/",
    );
    expect(iframe.getAttribute("src")).toContain("v=7");
  });

  it("sends props once ready, again only when they change, with stable functions", () => {
    const onPick = vi.fn(() => "picked");
    const { rerender } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="main"
        fit="content"
        props={{ hostId: 1, onPick, nested: { cb: onPick } }}
      />,
    );
    expect(frames.emitted).toEqual([]);
    act(() => frames.options!.onReady());
    expect(frames.emitted).toHaveLength(1);
    const sent = frames.emitted[0][1] as {
      hostId: number;
      onPick: () => string;
      nested: { cb: () => string };
    };
    expect(sent.hostId).toBe(1);
    expect(sent.onPick()).toBe("picked");
    expect(sent.nested.cb()).toBe("picked");

    const onPick2 = vi.fn(() => "second");
    rerender(
      <PluginFrameView
        pluginId="docker"
        frameKey="main"
        fit="content"
        props={{ hostId: 1, onPick: onPick2, nested: { cb: onPick2 } }}
      />,
    );
    expect(frames.emitted).toHaveLength(1);
    expect(sent.onPick()).toBe("second");

    rerender(
      <PluginFrameView
        pluginId="docker"
        frameKey="main"
        fit="content"
        props={{ hostId: 2, onPick: onPick2 }}
      />,
    );
    expect(frames.emitted).toHaveLength(2);
  });

  it("takes the size the frame reports, clamped, and ignores junk", () => {
    const { container } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="k"
        fit="inline"
        props={{}}
      />,
    );
    const iframe = container.querySelector("iframe")!;
    act(() => frames.options!.onEvent("size", { width: 50_000, height: 30 }));
    expect(iframe.style.width).toBe("10000px");
    act(() => frames.options!.onEvent("size", { width: "x" }));
    act(() => frames.options!.onEvent("other", { width: 1, height: 1 }));
    expect(iframe.style.width).toBe("10000px");
  });

  it("closes the connection when it goes away", async () => {
    const { unmount } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="k"
        fit="fill"
        transparent
        props={{}}
      />,
    );
    unmount();
    await Promise.resolve();
    expect(frames.closed).toBe(1);
  });

  it("shows the owner's fallback while an inline view draws nothing", () => {
    const { container, queryByText } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="slot:x"
        fit="inline"
        fallback={<span>Offline</span>}
        props={{}}
      />,
    );
    expect(queryByText("Offline")).not.toBeNull();
    act(() => frames.options!.onEvent("size", { width: 0, height: 0 }));
    expect(queryByText("Offline")).not.toBeNull();
    act(() => frames.options!.onEvent("size", { width: 40, height: 16 }));
    expect(queryByText("Offline")).toBeNull();
    const frame = container.querySelector("iframe")!;
    expect(frame.style.width).toBe("40px");
    expect(frame.style.position).toBe("");
  });

  it("sizes a bar view to its width and the bar's full height", () => {
    const { container } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="slot:tabbar.actions:x"
        fit="bar"
        props={{}}
      />,
    );
    const frame = container.querySelector("iframe")!;
    expect(frame.src).toContain("bar=1");
    expect(frame.src).not.toContain("inline=1");
    act(() => frames.options!.onEvent("size", { width: 44, height: 15 }));
    expect(frame.style.width).toBe("44px");
    expect(frame.style.height).toBe("100%");
    // See-through, and no inline border so the bar's dividers show.
    expect(frame.src).toContain("bg=none");
    expect(frame.style.borderWidth).toBe("");
  });

  it("keeps an overlay see-through and out of the way until it draws", () => {
    const { container } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="slot:terminal.overlay:x"
        fit="overlay"
        props={{}}
      />,
    );
    const frame = container.querySelector("iframe")!;
    expect(frame.src).toContain("bg=none");
    expect(frame.src).toContain("drawn=1");
    expect(frame.src).toContain("fit=fill");
    expect(frame.style.visibility).toBe("hidden");
    expect(frame.style.pointerEvents).toBe("none");
    act(() => frames.options!.onEvent("drawn", { drawn: true }));
    expect(frame.style.visibility).toBe("");
    act(() => frames.options!.onEvent("drawn", { drawn: false }));
    expect(frame.style.visibility).toBe("hidden");
  });

  it("passes events on and lets the shell move focus into a placed view", () => {
    const seen: Array<[string, unknown]> = [];
    let control: { focusEdge: (edge: "first" | "last") => void } | null = null;
    const { container } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="k"
        fit="content"
        edge
        props={{}}
        onFrameEvent={(name, data) => seen.push([name, data])}
        controlRef={(next) => {
          control = next;
        }}
      />,
    );
    expect(container.querySelector("iframe")!.src).toContain("edge=1");
    act(() => frames.options!.onEvent("size", { width: 10, height: 20 }));
    act(() => frames.options!.onEvent("focusOut", { dir: "next" }));
    expect(seen).toEqual([
      ["size", { width: 10, height: 20 }],
      ["focusOut", { dir: "next" }],
    ]);
    control!.focusEdge("last");
    expect(frames.emitted).toContainEqual(["focusEdge", "last"]);
  });

  it("shows a spinner while a slow full size view loads", () => {
    vi.useFakeTimers();
    const { container } = render(
      <PluginFrameView
        pluginId="docker"
        frameKey="main"
        fit="fill"
        props={{}}
      />,
    );
    const spinner = () => container.querySelector("[data-slot=loading-state]");
    expect(spinner()).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(spinner()).not.toBeNull();
    act(() => frames.options!.onReady());
    expect(spinner()).toBeNull();
    vi.useRealTimers();
  });

  it("shows no spinner for a see-through or inline view", () => {
    vi.useFakeTimers();
    const { container } = render(
      <>
        <PluginFrameView
          pluginId="docker"
          frameKey="a"
          fit="inline"
          props={{}}
        />
        <PluginFrameView
          pluginId="docker"
          frameKey="b"
          fit="overlay"
          props={{}}
        />
      </>,
    );
    act(() => vi.advanceTimersByTime(400));
    expect(container.querySelector("[data-slot=loading-state]")).toBeNull();
    vi.useRealTimers();
  });
});
