import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import type { Host } from "@/types/ui-types";

const api = vi.hoisted(() => ({
  getServerMetricsById: vi.fn(),
  startMetricsPolling: vi.fn(),
  stopMetricsPolling: vi.fn(),
}));
const hostActionsApi = vi.hoisted(() => ({
  getSshActions: vi.fn(),
}));
const mobileApi = vi.hoisted(() => ({
  isMobile: false as boolean | undefined,
}));

vi.mock("@/api/host-metrics-status-api", () => api);
vi.mock("@/sidebar/tree/HostItem/HostItem", () => hostActionsApi);
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileApi.isMobile,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "terminalToolbar.detachTmux": "Detach tmux",
        "terminalToolbar.detachTmuxDescription": "Detach tmux session",
        "terminalToolbar.image": "Image actions (images only)",
        "terminalToolbar.upload": "Upload image",
        "terminalToolbar.uploadImage": "Upload an image to the host",
        "terminalToolbar.uploadingImage": "Uploading image…",
        "terminalToolbar.paste": "Paste image",
        "terminalToolbar.pasteImage":
          "Paste image from clipboard (images only)",
        "terminalToolbar.showActions": "Show toolbar",
        "terminalToolbar.showToolbar": "Expand toolbar",
        "terminalToolbar.hideToolbar": "Hide toolbar",
        "terminalToolbar.layout": "Toolbar display mode",
        "terminalToolbar.layoutIcon": "Icon only",
        "terminalToolbar.layoutLabeled": "Icons and labels",
        "terminalToolbar.layoutExpanded": "Expanded with metrics",
        "terminalToolbar.moveToolbar": "Move toolbar",
        "terminalToolbar.moveToolbarHint": "Drag to reposition the toolbar",
        "terminalToolbar.imageActionFailed": "Image action failed",
        "terminalToolbar.retry": "Retry",
        "terminalToolbar.dismissError": "Dismiss image error",
      })[key] ?? key,
  }),
}));

import { TerminalToolbar } from "@/features/terminal/TerminalToolbar";
import {
  clampToolbarPosition,
  getResponsiveToolbarDensity,
} from "@/features/terminal/toolbar-geometry";

const host = { id: 7, connectionType: "ssh" } as unknown as Host;

function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof TerminalToolbar>> = {},
) {
  const props: React.ComponentProps<typeof TerminalToolbar> = {
    host,
    isConnected: true,
    isTmuxAttached: true,
    onTmuxDetach: vi.fn(),
    isImageUploading: false,
    onUploadImage: vi.fn(),
    onPasteImage: vi.fn(),
    isFocused: true,
    ...overrides,
  };
  return { ...render(<TerminalToolbar {...props} />), props };
}

// jsdom lacks the pointer APIs Radix Select needs to open its popup.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  vi.clearAllMocks();
  mobileApi.isMobile = false;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
  localStorage.clear();
  hostActionsApi.getSshActions.mockReturnValue([]);
  api.startMetricsPolling.mockResolvedValue({ viewerSessionId: "viewer" });
  api.getServerMetricsById.mockResolvedValue(null);
  api.stopMetricsPolling.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("responsive toolbar density", () => {
  it("enters below 110 percent and restores at 115 percent", () => {
    expect(getResponsiveToolbarDensity("labeled", "labeled", 1099, 1000)).toBe(
      "icon",
    );
    expect(getResponsiveToolbarDensity("labeled", "labeled", 1100, 1000)).toBe(
      "labeled",
    );
    expect(getResponsiveToolbarDensity("labeled", "icon", 1149, 1000)).toBe(
      "icon",
    );
    expect(getResponsiveToolbarDensity("labeled", "icon", 1150, 1000)).toBe(
      "labeled",
    );
  });

  it("never falls back when Icon is explicitly selected", () => {
    expect(getResponsiveToolbarDensity("icon", "icon", 10, 1000)).toBe("icon");
    expect(getResponsiveToolbarDensity("icon", "icon", 2000, 1000)).toBe(
      "icon",
    );
  });

  it("retains the prior effective state while measurement is unavailable", () => {
    expect(getResponsiveToolbarDensity("expanded", "expanded", 0, 1000)).toBe(
      "expanded",
    );
    expect(getResponsiveToolbarDensity("expanded", "icon", 0, 1000)).toBe(
      "icon",
    );
  });
});

describe("TerminalToolbar Phase 1", () => {
  it("clamps vertical movement and preserves over-tall recovery", () => {
    const hostRect = {
      left: 0,
      right: 400,
      top: 0,
      bottom: 200,
      width: 400,
      height: 200,
    };
    const toolbarRect = {
      left: 100,
      right: 300,
      top: 140,
      bottom: 190,
      width: 200,
      height: 50,
    };
    expect(
      clampToolbarPosition({ x: 0, y: -999 }, toolbarRect, hostRect, {
        x: 0,
        y: 0,
      }).y,
    ).toBe(-132);
    expect(
      clampToolbarPosition({ x: 0, y: 999 }, toolbarRect, hostRect, {
        x: 0,
        y: 0,
      }).y,
    ).toBe(2);
    expect(
      clampToolbarPosition(
        { x: 0, y: -999 },
        { ...toolbarRect, top: 150, bottom: 350, height: 200 },
        hostRect,
        { x: 0, y: 0 },
      ).y,
    ).toBe(-298);
  });

  it("keeps horizontal outputs unchanged during simultaneous movement", () => {
    const hostRect = {
      left: 100,
      right: 500,
      top: 50,
      bottom: 350,
      width: 400,
      height: 300,
    };
    const toolbarRect = {
      left: 250,
      right: 450,
      top: 280,
      bottom: 330,
      width: 200,
      height: 50,
    };
    expect(
      clampToolbarPosition({ x: -999, y: -100 }, toolbarRect, hostRect, {
        x: 0,
        y: 0,
      }),
    ).toEqual({ x: -142, y: -100 });
    expect(
      clampToolbarPosition({ x: 999, y: 12 }, toolbarRect, hostRect, {
        x: 0,
        y: 0,
      }),
    ).toEqual({ x: 42, y: 12 });
  });

  it("fills the full terminal surface while remaining bottom-centered and pointer transparent", () => {
    const { container } = renderToolbar();
    const toolbarHost = container.querySelector("[data-terminal-toolbar-host]");
    const toolbar = container.querySelector("[data-terminal-toolbar-wide]");
    expect(toolbarHost).toHaveClass(
      "absolute",
      "inset-0",
      "flex",
      "items-end",
      "justify-center",
      "pointer-events-none",
      "pb-2",
    );
    expect(toolbarHost).not.toHaveClass("inset-x-2", "bottom-2");
    expect(toolbar).toHaveClass("pointer-events-auto");
    expect(toolbar).toHaveStyle({ transform: "translate(0px, 0px)" });
  });

  it("clamps every edge and preserves recovery for an over-wide toolbar", () => {
    const hostRect = {
      left: 100,
      right: 500,
      top: 50,
      bottom: 350,
      width: 400,
      height: 300,
    };
    const toolbar = {
      left: 250,
      right: 450,
      top: 280,
      bottom: 330,
      width: 200,
      height: 50,
    };
    expect(
      clampToolbarPosition({ x: -500, y: 0 }, toolbar, hostRect, {
        x: 0,
        y: 0,
      }),
    ).toEqual({
      x: -142,
      y: 0,
    });
    expect(
      clampToolbarPosition({ x: 500, y: 0 }, toolbar, hostRect, { x: 0, y: 0 }),
    ).toEqual({
      x: 42,
      y: 0,
    });
    expect(
      clampToolbarPosition({ x: 0, y: -500 }, toolbar, hostRect, {
        x: 0,
        y: 0,
      }),
    ).toEqual({
      x: 0,
      y: -222,
    });
    expect(
      clampToolbarPosition({ x: 0, y: 500 }, toolbar, hostRect, { x: 0, y: 0 }),
    ).toEqual({
      x: 0,
      y: 12,
    });
    expect(
      clampToolbarPosition(
        { x: -999, y: 0 },
        { ...toolbar, left: -100, right: 600, width: 700 },
        hostRect,
        { x: 0, y: 0 },
      ).x,
    ).toBe(-448);
  });

  it("clamps an off-screen restored position to actual host bounds", async () => {
    localStorage.setItem(
      "termix-terminal-toolbar-position-v2",
      JSON.stringify({ x: 9000, y: -9000 }),
    );
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        if (this.hasAttribute("data-terminal-toolbar-host")) {
          return DOMRect.fromRect({ x: 100, y: 50, width: 500, height: 300 });
        }
        if (this.hasAttribute("data-terminal-toolbar-wide")) {
          const match = this.style.transform.match(
            /translate\(([-\d.]+)px, ([-\d.]+)px\)/,
          );
          const x = Number(match?.[1] ?? 0);
          const y = Number(match?.[2] ?? 0);
          return DOMRect.fromRect({
            x: 250 + x,
            y: 250 + y,
            width: 250,
            height: 50,
          });
        }
        return original.call(this);
      },
    );
    const { container } = renderToolbar();
    await waitFor(() =>
      expect(
        (container.querySelector("[data-terminal-toolbar-wide]") as HTMLElement)
          .style.transform,
      ).toBe("translate(0px, 0px)"),
    );
  });

  it("renders the PC toolbar and Image group with adjacent actions", () => {
    const { container } = renderToolbar();
    expect(container.querySelector("[data-terminal-toolbar-host]")).toHaveClass(
      "@container",
    );
    expect(container.querySelector("[data-terminal-toolbar-wide]")).toHaveClass(
      "pointer-events-auto",
    );
    expect(
      container.querySelector("[data-terminal-toolbar-narrow]"),
    ).toBeNull();

    const imageGroup = screen.getAllByRole("group", {
      name: "Image actions (images only)",
    })[0];
    expect(imageGroup.querySelectorAll("button, label")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Upload an image to the host" })[0],
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", {
        name: "Paste image from clipboard (images only)",
      })[0],
    ).toBeVisible();
  });

  it("uses explicit labels, conditional tmux, and compact interactive targets", () => {
    const { rerender, props } = renderToolbar();
    expect(
      screen.getAllByRole("button", { name: "Detach tmux session" })[0],
    ).toHaveTextContent("Detach tmux");
    expect(
      screen.getAllByRole("button", { name: "Detach tmux session" })[0],
    ).toHaveClass("min-h-8", "min-w-8");
    rerender(<TerminalToolbar {...props} isTmuxAttached={false} />);
    expect(
      screen.queryByRole("button", { name: "Detach tmux session" }),
    ).not.toBeInTheDocument();
  });

  it("exposes density as a select and applies the chosen mode", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const trigger = screen.getByRole("combobox", {
      name: "Toolbar display mode",
    });
    expect(trigger).toHaveTextContent("");
    await user.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Icon only",
      "Icons and labels",
      "Expanded with metrics",
    ]);
    await user.click(
      screen.getByRole("option", { name: "Expanded with metrics" }),
    );
    await waitFor(() =>
      expect(localStorage.getItem("termix-terminal-toolbar-density")).toBe(
        "expanded",
      ),
    );
  });

  it("keeps one file input mounted, resets repeated selections, and exposes loading", () => {
    const onUploadImage = vi.fn();
    const { container, rerender, props } = renderToolbar({ onUploadImage });
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
    const file = new File(["image"], "same.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUploadImage).toHaveBeenCalledTimes(2);
    rerender(<TerminalToolbar {...props} isImageUploading />);
    expect(container.querySelector('input[type="file"]')).toBe(input);
    expect(screen.getByRole("status")).toHaveTextContent("Uploading image…");
    expect(
      screen.getAllByRole("button", { name: "Upload an image to the host" })[0],
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", {
        name: "Paste image from clipboard (images only)",
      })[0],
    ).toBeDisabled();
  });

  it("hides clearly, leaves recovery, and closes open UI on disconnect", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderToolbar();
    await user.click(screen.getByRole("button", { name: "Hide toolbar" }));
    const collapsedMover = screen.getByRole("button", {
      name: "Move toolbar",
    });
    expect(collapsedMover).toHaveAttribute("aria-label", "Move toolbar");
    await user.click(screen.getByRole("button", { name: "Expand toolbar" }));
    expect(
      screen.getByRole("combobox", { name: "Toolbar display mode" }),
    ).toBeInTheDocument();
    rerender(<TerminalToolbar {...props} isConnected={false} />);
    expect(
      screen.queryByRole("combobox", { name: "Toolbar display mode" }),
    ).not.toBeInTheDocument();
  });

  it("calls paste synchronously in the activation handler and does not cancel outside pointerdown", () => {
    const onPasteImage = vi.fn();
    renderToolbar({ onPasteImage });
    const paste = screen.getAllByRole("button", {
      name: "Paste image from clipboard (images only)",
    })[0];
    fireEvent.click(paste);
    expect(onPasteImage).toHaveBeenCalledOnce();
    const outside = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
  });

  it("shows an actionable image error and retries the failed activation", async () => {
    const user = userEvent.setup();
    const onPasteImage = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Clipboard permission denied"))
      .mockResolvedValueOnce();
    renderToolbar({ onPasteImage });
    await user.click(
      screen.getAllByRole("button", {
        name: "Paste image from clipboard (images only)",
      })[0],
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Clipboard permission denied",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onPasteImage).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("routes synchronous image failures through the alert flow", async () => {
    renderToolbar({
      onPasteImage: vi.fn(() => {
        throw new Error("Synchronous clipboard failure");
      }),
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Paste image from clipboard (images only)",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synchronous clipboard failure",
    );
  });

  it("orders desktop actions and keeps the grab handle persistent", () => {
    hostActionsApi.getSshActions.mockReturnValue([
      { type: "files", icon: () => null, label: "Files" },
      { type: "host-metrics", icon: () => null, label: "Host Metrics" },
      { type: "tmux_monitor", icon: () => null, label: "Tmux Monitor" },
    ]);
    const { container } = renderToolbar();
    const labels = Array.from(
      container.querySelectorAll("[data-terminal-toolbar-wide] button"),
    ).map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Files",
      "Host Metrics",
      "Tmux Monitor",
      "Detach tmux session",
      "Upload an image to the host",
      "Paste image from clipboard (images only)",
      "Toolbar display mode",
      "Hide toolbar",
      "Move toolbar",
    ]);
  });

  it("shows three modes and fades the expanded toolbar", async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar();
    const toolbar = container.querySelector(
      "[data-terminal-toolbar-wide]",
    ) as HTMLElement;
    expect(toolbar).toHaveClass(
      "opacity-30",
      "transition-opacity",
      "hover:opacity-100",
      "focus-within:opacity-100",
    );
    await user.click(
      screen.getByRole("combobox", { name: "Toolbar display mode" }),
    );
    expect(await screen.findAllByRole("option")).toHaveLength(3);
  });

  it("gives the collapsed toolbar idle opacity and keyboard recovery", async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar();
    await user.click(screen.getByRole("button", { name: "Hide toolbar" }));
    const toolbar = container.querySelector(
      "[data-terminal-toolbar-wide]",
    ) as HTMLElement;
    expect(toolbar).toHaveClass(
      "opacity-100",
      "hover:opacity-100",
      "focus-within:opacity-100",
    );
    expect(
      screen.getByRole("button", { name: "Expand toolbar" }),
    ).toBeVisible();
    const collapsedMover = screen.getByRole("button", {
      name: "Move toolbar",
    });
    expect(collapsedMover).toBeVisible();
    expect(
      container.querySelector(".terminal-toolbar-collapsed-shell"),
    ).toBeInTheDocument();
    collapsedMover.focus();
    expect(toolbar).toHaveClass("focus-within:opacity-100");
    const expandButton = screen.getByRole("button", {
      name: "Expand toolbar",
    });
    expandButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Hide toolbar" }),
      ).toHaveFocus(),
    );
  }, 15_000);

  it("keeps the mover on the right edge across collapse and expansion", async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        if (this.hasAttribute("data-terminal-toolbar-host")) {
          return DOMRect.fromRect({ x: 100, y: 50, width: 500, height: 300 });
        }
        if (this.hasAttribute("data-terminal-toolbar-wide")) {
          const match = this.style.transform.match(
            /translate\(([-\d.]+)px, ([-\d.]+)px\)/,
          );
          const collapsed = !this.querySelector(
            'button[aria-label="Hide toolbar"]',
          );
          return DOMRect.fromRect({
            x: 225 + Number(match?.[1] ?? 0),
            y: 290 + Number(match?.[2] ?? 0),
            width: collapsed ? 44 : 250,
            height: collapsed ? 44 : 50,
          });
        }
        return original.call(this);
      },
    );
    localStorage.setItem(
      "termix-terminal-toolbar-position-v2",
      JSON.stringify({ x: 117, y: 2 }),
    );
    const { container } = renderToolbar();
    const toolbar = container.querySelector(
      "[data-terminal-toolbar-wide]",
    ) as HTMLElement;
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Hide toolbar" }));
    expect(toolbar.style.transform).toBe("translate(323px, 2px)");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Expand toolbar" }));
    expect(toolbar.style.transform).toBe("translate(117px, 2px)");
  });

  it("moves and persists the toolbar position, then stops after pointerup", () => {
    const { container, unmount } = renderToolbar();
    const grab = screen.getByRole("button", { name: "Move toolbar" });
    const toolbar = container.querySelector(
      "[data-terminal-toolbar-wide]",
    ) as HTMLElement;
    fireEvent.pointerDown(grab, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(grab, {
      pointerId: 1,
      clientX: 140,
      clientY: 90,
    });
    expect(toolbar.style.transform).toBe("translate(40px, -10px)");
    fireEvent.pointerUp(grab, { pointerId: 1 });
    expect(
      JSON.parse(localStorage.getItem("termix-terminal-toolbar-position-v2")!),
    ).toEqual({ x: 40, y: -10 });
    fireEvent.pointerMove(grab, {
      pointerId: 1,
      clientX: 500,
      clientY: 500,
    });
    expect(toolbar.style.transform).toBe("translate(40px, -10px)");
    unmount();
    const second = renderToolbar();
    expect(
      (
        second.container.querySelector(
          "[data-terminal-toolbar-wide]",
        ) as HTMLElement
      ).style.transform,
    ).toBe("translate(40px, -10px)");
  });

  it("moves on both axes, clamps safely, ignores a different pointer ID, and persists", () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        if (this.hasAttribute("data-terminal-toolbar-host")) {
          return DOMRect.fromRect({ x: 100, y: 50, width: 500, height: 300 });
        }
        if (this.hasAttribute("data-terminal-toolbar-wide")) {
          const match = this.style.transform.match(
            /translate\(([-\d.]+)px, ([-\d.]+)px\)/,
          );
          return DOMRect.fromRect({
            x: 225 + Number(match?.[1] ?? 0),
            y: 290 + Number(match?.[2] ?? 0),
            width: 250,
            height: 50,
          });
        }
        return original.call(this);
      },
    );
    const { container } = renderToolbar();
    const grab = screen.getByRole("button", { name: "Move toolbar" });
    const toolbar = container.querySelector(
      "[data-terminal-toolbar-wide]",
    ) as HTMLElement;
    fireEvent.pointerDown(grab, {
      pointerId: 11,
      button: 0,
      clientX: 10,
      clientY: 100,
    });
    fireEvent.pointerMove(grab, {
      pointerId: 12,
      clientX: 30,
      clientY: -500,
    });
    expect(toolbar).toHaveStyle({ transform: "translate(0px, 0px)" });
    fireEvent.pointerMove(grab, {
      pointerId: 11,
      clientX: 30,
      clientY: 120,
    });
    expect(toolbar.style.transform).toBe("translate(20px, 2px)");
    fireEvent.pointerMove(grab, {
      pointerId: 11,
      clientX: 500,
      clientY: 500,
    });
    expect(toolbar.style.transform).toBe("translate(117px, 2px)");
    fireEvent.pointerMove(grab, {
      pointerId: 11,
      clientX: 500,
      clientY: 500,
    });
    expect(toolbar.style.transform).toBe("translate(117px, 2px)");
    fireEvent.pointerUp(grab, { pointerId: 11 });
    expect(
      JSON.parse(localStorage.getItem("termix-terminal-toolbar-position-v2")!),
    ).toEqual({ x: 117, y: 2 });
  });

  it("avoids ResizeObserver write churn and writes one real reclamp", async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    class ControlledResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
    let hostWidth = 500;
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        if (this.hasAttribute("data-terminal-toolbar-host")) {
          return DOMRect.fromRect({
            x: 0,
            y: 0,
            width: hostWidth,
            height: 300,
          });
        }
        if (this.hasAttribute("data-terminal-toolbar-wide")) {
          const match = this.style.transform.match(
            /translate\(([-\d.]+)px, ([-\d.]+)px\)/,
          );
          return DOMRect.fromRect({
            x: 125 + Number(match?.[1] ?? 0),
            y: 242 + Number(match?.[2] ?? 0),
            width: 250,
            height: 50,
          });
        }
        return original.call(this);
      },
    );
    const writes = vi.spyOn(Storage.prototype, "setItem");
    renderToolbar();
    writes.mockClear();
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(writes).not.toHaveBeenCalledWith(
      "termix-terminal-toolbar-position-v2",
      expect.any(String),
    );
    hostWidth = 200;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(writes).not.toHaveBeenCalledWith(
      "termix-terminal-toolbar-position-v2",
      expect.any(String),
    );
    expect(
      writes.mock.calls.filter(
        ([key]) => key === "termix-terminal-toolbar-position-v2",
      ),
    ).toHaveLength(0);
  });

  it.each([undefined, true])(
    "does not mount or run desktop side effects when mobile is %s",
    (isMobile) => {
      mobileApi.isMobile = isMobile;
      localStorage.setItem("termix-terminal-toolbar-density", "expanded");
      const writes = vi.spyOn(Storage.prototype, "setItem");
      const addWindowListener = vi.spyOn(window, "addEventListener");
      const resizeObserver = vi.fn();
      vi.stubGlobal("ResizeObserver", resizeObserver);

      const { container } = renderToolbar();

      expect(
        container.querySelector("[data-terminal-toolbar-host]"),
      ).not.toBeInTheDocument();
      expect(api.startMetricsPolling).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(resizeObserver).not.toHaveBeenCalled();
      expect(addWindowListener).not.toHaveBeenCalledWith(
        "resize",
        expect.any(Function),
      );
    },
  );

  it("mounts the toolbar and polls metrics once desktop is confirmed", async () => {
    mobileApi.isMobile = false;
    localStorage.setItem("termix-terminal-toolbar-density", "expanded");
    const { container } = renderToolbar();
    expect(
      container.querySelector("[data-terminal-toolbar-host]"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.startMetricsPolling).toHaveBeenCalledWith(7),
    );
  });

  it("ends dragging on pointer cancellation and lost capture, and rejects touch", () => {
    const { container } = renderToolbar();
    const grab = screen.getByRole("button", { name: "Move toolbar" });
    const toolbar = container.querySelector(
      "[data-terminal-toolbar-wide]",
    ) as HTMLElement;
    fireEvent.pointerDown(grab, {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(grab, { pointerId: 2, clientX: 50, clientY: 50 });
    expect(toolbar.style.transform).toBe("translate(0px, 0px)");

    fireEvent.pointerDown(grab, {
      pointerId: 3,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerCancel(grab, { pointerId: 3 });
    fireEvent.pointerMove(grab, { pointerId: 3, clientX: 50, clientY: 50 });
    expect(toolbar.style.transform).toBe("translate(0px, 0px)");

    fireEvent.pointerDown(grab, {
      pointerId: 4,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.lostPointerCapture(grab, { pointerId: 4 });
    fireEvent.pointerMove(grab, { pointerId: 4, clientX: 50, clientY: 50 });
    expect(toolbar.style.transform).toBe("translate(0px, 0px)");
  });

  it("ignores stale image completions after an instance change in Strict Mode", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const props = {
      host,
      isConnected: true,
      isTmuxAttached: false,
      onTmuxDetach: vi.fn(),
      isImageUploading: false,
      onUploadImage: vi.fn(),
      onPasteImage: vi.fn(() => pending),
      isFocused: true,
    };
    const { rerender } = render(
      <StrictMode>
        <TerminalToolbar {...props} />
      </StrictMode>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Paste image from clipboard (images only)",
      }),
    );
    rerender(
      <StrictMode>
        <TerminalToolbar
          {...props}
          host={{ ...host, id: 8 } as unknown as Host}
        />
      </StrictMode>,
    );
    reject(new Error("old instance"));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stops a metrics viewer that resolves after cleanup", async () => {
    let resolveStart!: (value: { viewerSessionId: string }) => void;
    api.startMetricsPolling.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    localStorage.setItem("termix-terminal-toolbar-density", "expanded");
    const view = renderToolbar();
    view.unmount();
    resolveStart({ viewerSessionId: "late-viewer" });
    await waitFor(() =>
      expect(api.stopMetricsPolling).toHaveBeenCalledWith(7, "late-viewer"),
    );
  });
});
