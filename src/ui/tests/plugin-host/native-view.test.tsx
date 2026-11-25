import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NativeView } from "@/plugin-host/NativeView";
import { embeddedViewCoordinator } from "@/plugin-host/embedded-view-coordinator";

const api = {
  open: vi.fn().mockResolvedValue(undefined),
  setBounds: vi.fn().mockResolvedValue(undefined),
  setVisible: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

function useDesktop() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    embeddedView: api,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 5, top: 6, width: 400, height: 300 }) as DOMRect;
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.unstubAllGlobals();
});

describe("NativeView", () => {
  it("renders the fallback outside the desktop app", () => {
    const { getByText } = render(
      <NativeView url="https://x.example/" fallback={<p>iframe here</p>} />,
    );
    expect(getByText("iframe here")).toBeTruthy();
  });

  it("opens a native view over its element and closes it on unmount", async () => {
    useDesktop();
    const { unmount } = render(<NativeView url="https://x.example/" />);
    await flush();
    expect(api.open).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://x.example/",
        bounds: { x: 5, y: 6, width: 400, height: 300 },
        visible: true,
      }),
    );
    // Only a grant from the plugin's backend can carry a certificate rule.
    expect(api.open.mock.calls[0][0]).not.toHaveProperty("ignoreCert");
    const id = api.open.mock.calls[0][0].id;
    unmount();
    expect(api.close).toHaveBeenCalledWith(id);
  });

  it("hides the view when hidden is set and shows it again", async () => {
    useDesktop();
    const { rerender } = render(<NativeView url="https://x.example/" />);
    await flush();
    const id = api.open.mock.calls[0][0].id;
    rerender(<NativeView url="https://x.example/" hidden />);
    await flush();
    expect(api.setVisible).toHaveBeenLastCalledWith(id, false);
    rerender(<NativeView url="https://x.example/" />);
    await flush();
    expect(api.setVisible).toHaveBeenLastCalledWith(id, true);
  });

  it("hides the view while a dialog is open", async () => {
    useDesktop();
    render(<NativeView url="https://x.example/" />);
    await flush();
    const id = api.open.mock.calls[0][0].id;
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    await flush();
    expect(api.setVisible).toHaveBeenLastCalledWith(id, false);
    dialog.remove();
  });

  it("shares a single body childList MutationObserver and rAF batch without polling intervals", async () => {
    useDesktop();
    const observeCalls: Array<{
      target: Node;
      options: MutationObserverInit | undefined;
    }> = [];
    let observerCount = 0;
    let disconnectCount = 0;
    const NativeMO = globalThis.MutationObserver;
    class TrackingMutationObserver {
      private inner: MutationObserver;
      constructor(cb: MutationCallback) {
        observerCount += 1;
        this.inner = new NativeMO(cb);
      }
      observe(target: Node, options?: MutationObserverInit) {
        observeCalls.push({ target, options });
        this.inner.observe(target, options);
      }
      disconnect() {
        disconnectCount += 1;
        this.inner.disconnect();
      }
      takeRecords() {
        return this.inner.takeRecords();
      }
    }
    vi.stubGlobal("MutationObserver", TrackingMutationObserver);

    const intervalSpy = vi.spyOn(window, "setInterval");
    const rafSpy = vi.fn((cb: () => void) => setTimeout(cb, 0));
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const { unmount } = render(
      <>
        <NativeView url="https://a.example/" />
        <NativeView url="https://b.example/" />
      </>,
    );

    expect(observerCount).toBe(1);
    expect(observeCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of observeCalls) {
      if (call.target === document.body) {
        expect(call.options?.subtree).toBeFalsy();
        expect(call.options?.childList).toBe(true);
      }
    }
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(embeddedViewCoordinator.size).toBe(2);
    expect(embeddedViewCoordinator.isAttached).toBe(true);

    await flush();
    expect(api.open).toHaveBeenCalledTimes(2);

    unmount();
    expect(embeddedViewCoordinator.size).toBe(0);
    expect(embeddedViewCoordinator.isAttached).toBe(false);
    expect(disconnectCount).toBeGreaterThanOrEqual(1);

    intervalSpy.mockRestore();
  });
});
