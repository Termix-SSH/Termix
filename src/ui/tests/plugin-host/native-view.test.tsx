import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NativeView } from "@/plugin-host/NativeView";

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
    const { unmount } = render(
      <NativeView url="https://x.example/" ignoreCert />,
    );
    await flush();
    expect(api.open).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://x.example/",
        ignoreCert: true,
        bounds: { x: 5, y: 6, width: 400, height: 300 },
        visible: true,
      }),
    );
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
});
