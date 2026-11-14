import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

type Options = {
  getProps: () => Record<string, unknown>;
  onReady: () => void;
  onEvent: (name: string, data: unknown) => void;
};

const frames = vi.hoisted(() => ({
  options: null as Options | null,
  emitted: [] as Array<[string, unknown]>,
  closed: 0,
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
});

describe("PluginFrameView", () => {
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

  it("closes the connection when it goes away", () => {
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
});
