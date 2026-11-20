import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => ({
    data: { url: `https://page.example.test/?from=${encodeURIComponent(url)}` },
  })),
}));
vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  authApi: { get: api.get },
}));

import {
  ForeignViewHost,
  ensureForeignConsumer,
  foreignStateFor,
  mountForeignView,
  placeForeignViews,
  resetForeignViews,
  runForeignPlacement,
} from "@/plugin-host/frames/foreign-views";

const GRANT = "a".repeat(48);
let iframe: HTMLIFrameElement;

function consumer(pluginId = "web-endpoint") {
  ensureForeignConsumer({
    owner: "c1",
    pluginId,
    iframe,
    emit: () => {},
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const embedded = {
  open: vi.fn(async () => ({ success: true })),
  setBounds: vi.fn(async () => undefined),
  setVisible: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
};

beforeEach(() => {
  api.get.mockClear();
  for (const fn of Object.values(embedded)) fn.mockClear();
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      x: 100,
      y: 50,
      width: 800,
      height: 600,
      right: 900,
      bottom: 650,
      toJSON: () => ({}),
    }) as DOMRect;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLIFrameElement.prototype, "credentialless", {
    configurable: true,
    writable: true,
    value: false,
  });
});

afterEach(() => {
  resetForeignViews();
  iframe.remove();
  document.getElementById("termix-foreign-views")?.remove();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  delete (HTMLIFrameElement.prototype as unknown as Record<string, unknown>)
    .credentialless;
  vi.unstubAllGlobals();
});

describe("granted web views in frames", () => {
  it("takes only a grant, never an address, from the frame", () => {
    consumer();
    expect(mountForeignView("c1", { id: "w1", web: GRANT })).toBe(true);
    expect(
      mountForeignView("c1", { id: "w2", web: "https://evil.example/" }),
    ).toBe(false);
    expect(mountForeignView("c1", { id: "w3", web: "A".repeat(48) })).toBe(
      false,
    );
    // An id already used for a grant can't be swapped to another page.
    expect(mountForeignView("c1", { id: "w1", web: "b".repeat(48) })).toBe(
      false,
    );
    expect(foreignStateFor("c1")?.views).toEqual([
      expect.objectContaining({ id: "w1", web: GRANT }),
    ]);
  });

  it("asks core for the page as the frame's own plugin, in a credentialless sandbox", async () => {
    consumer("web-endpoint");
    render(<ForeignViewHost />);
    act(() => {
      mountForeignView("c1", {
        id: "w1",
        web: GRANT,
        pluginId: "snoop",
        url: "https://evil.example/",
      });
    });
    await flush();
    expect(api.get).toHaveBeenCalledWith(
      `/plugins/web-endpoint/web-views/${GRANT}`,
    );
    const page = document.querySelector<HTMLIFrameElement>(
      "[data-granted-web-view] iframe",
    );
    expect(page?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(
      (page as HTMLIFrameElement & { credentialless?: boolean }).credentialless,
    ).toBe(true);
    expect(page?.src).toContain("https://page.example.test/");
  });

  it("draws a plain sandboxed page from another host without credentialless frames", async () => {
    delete (HTMLIFrameElement.prototype as unknown as Record<string, unknown>)
      .credentialless;
    consumer();
    render(<ForeignViewHost />);
    act(() => {
      mountForeignView("c1", { id: "w1", web: GRANT });
    });
    await flush();
    const page = document.querySelector<HTMLIFrameElement>(
      "[data-granted-web-view] iframe",
    );
    expect(page?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(page?.src).toContain("https://page.example.test/");
  });

  it("refuses a page on Termix's own host without credentialless frames", async () => {
    delete (HTMLIFrameElement.prototype as unknown as Record<string, unknown>)
      .credentialless;
    api.get.mockResolvedValueOnce({
      data: { url: `http://${window.location.hostname}:8080/` },
    });
    consumer();
    render(<ForeignViewHost />);
    act(() => {
      mountForeignView("c1", { id: "w1", web: GRANT });
    });
    await flush();
    expect(document.querySelector("[data-granted-web-view] iframe")).toBeNull();
    expect(
      document.querySelector("[data-granted-web-view]")?.textContent,
    ).toContain("open the page safely");
  });

  it("opens the native view from the grant and the frame's plugin id", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      embeddedView: embedded,
    };
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 0),
    );
    consumer("web-endpoint");
    render(<ForeignViewHost />);
    act(() => {
      mountForeignView("c1", { id: "w1", web: GRANT });
      placeForeignViews("c1", {
        views: [
          {
            id: "w1",
            rect: { x: 10, y: 20, width: 300, height: 200 },
            clip: { x: 10, y: 20, width: 300, height: 100 },
            visible: true,
          },
        ],
      });
      runForeignPlacement();
    });
    await flush();
    await flush();
    expect(embedded.open).toHaveBeenCalledTimes(1);
    const options = (embedded.open.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(options).toMatchObject({ grant: GRANT, pluginId: "web-endpoint" });
    expect(options).not.toHaveProperty("url");
    expect(options).not.toHaveProperty("ignoreCert");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("falls back to the sandboxed iframe when main does not know the grant", async () => {
    embedded.open.mockResolvedValueOnce({ success: false } as never);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      embeddedView: embedded,
    };
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
      setTimeout(cb, 0),
    );
    consumer();
    render(<ForeignViewHost />);
    act(() => {
      mountForeignView("c1", { id: "w1", web: GRANT });
    });
    await flush();
    await flush();
    await flush();
    expect(api.get).toHaveBeenCalledWith(
      `/plugins/web-endpoint/web-views/${GRANT}`,
    );
  });
});
