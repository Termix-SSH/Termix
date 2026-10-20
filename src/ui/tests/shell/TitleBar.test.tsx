import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { TitleBar, useTitleBarOverlayColors } from "@/shell/TitleBar";

vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ appName: "Termix" }),
}));

type Listener = (visible: boolean) => void;

function installBridge(options: { visible?: boolean } = {}) {
  let listener: Listener | null = null;
  const api = {
    getPlatform: vi.fn().mockResolvedValue("darwin"),
    getTitleBarVisible: vi.fn().mockResolvedValue(options.visible ?? true),
    onTitleBarVisibleChange: vi.fn((callback: Listener) => {
      listener = callback;
      return () => {
        listener = null;
      };
    }),
    setTitleBarOverlay: vi.fn().mockResolvedValue(undefined),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  return { api, emit: (visible: boolean) => listener?.(visible) };
}

const heightVar = () =>
  document.documentElement.style.getPropertyValue("--termix-titlebar-height");

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

describe("TitleBar", () => {
  it("renders nothing and sets no offset outside the desktop app", () => {
    const { container } = render(<TitleBar />);
    expect(container.firstChild).toBeNull();
    expect(heightVar()).toBe("");
  });

  it("shows the bar and sets the offset when the window has one", async () => {
    installBridge();
    render(<TitleBar />);
    expect(await screen.findByText("Termix")).toBeTruthy();
    expect(heightVar()).toBe("40px");
  });

  it("stays hidden in windows without the app-drawn bar", async () => {
    const { api } = installBridge({ visible: false });
    const { container } = render(<TitleBar />);
    await waitFor(() => expect(api.getTitleBarVisible).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(heightVar()).toBe("");
  });

  it("hides and clears the offset in full screen, and comes back after", async () => {
    const { emit } = installBridge();
    render(<TitleBar />);
    await screen.findByText("Termix");

    act(() => emit(false));
    expect(screen.queryByText("Termix")).toBeNull();
    expect(heightVar()).toBe("");

    act(() => emit(true));
    expect(screen.getByText("Termix")).toBeTruthy();
    expect(heightVar()).toBe("40px");
  });

  it("unsubscribes from visibility changes on unmount", async () => {
    const { api, emit } = installBridge();
    const { unmount } = render(<TitleBar />);
    await screen.findByText("Termix");
    unmount();
    expect(() => emit(false)).not.toThrow();
    expect(api.onTitleBarVisibleChange).toHaveBeenCalledTimes(1);
    expect(heightVar()).toBe("");
  });
});

function OverlayColors() {
  useTitleBarOverlayColors();
  return null;
}

describe("useTitleBarOverlayColors", () => {
  it("sends the computed theme colors as hex", () => {
    const { api } = installBridge();
    document.body.style.backgroundColor = "rgb(15, 15, 20)";
    document.body.style.color = "rgb(230, 230, 234)";
    render(<OverlayColors />);
    expect(api.setTitleBarOverlay).toHaveBeenCalledWith({
      color: "#0f0f14",
      symbolColor: "#e6e6ea",
    });
  });

  it("sends the new colors when the theme class changes", async () => {
    const { api } = installBridge();
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    render(<OverlayColors />);
    api.setTitleBarOverlay.mockClear();

    document.body.style.backgroundColor = "rgb(40, 42, 54)";
    document.documentElement.classList.add("dracula");
    await waitFor(() =>
      expect(api.setTitleBarOverlay).toHaveBeenCalledWith(
        expect.objectContaining({ color: "#282a36" }),
      ),
    );
    document.documentElement.classList.remove("dracula");
  });

  it("sends nothing when the background color cannot be read", () => {
    const { api } = installBridge();
    document.body.style.backgroundColor = "transparent";
    render(<OverlayColors />);
    expect(api.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
