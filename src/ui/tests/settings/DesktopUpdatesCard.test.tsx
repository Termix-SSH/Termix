import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DesktopUpdatesCard } from "@/settings/DesktopUpdatesCard";
import type { DesktopUpdateState } from "@/lib/desktop-updates";

type TestWindow = { electronAPI?: unknown };

function state(patch: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    kind: "auto",
    mode: "prompt",
    currentVersion: "26.10.1",
    status: "idle",
    version: null,
    releaseUrl: null,
    progress: null,
    error: null,
    ...patch,
  };
}

function bridge(initial: DesktopUpdateState) {
  return {
    getState: vi.fn(async () => initial),
    check: vi.fn(async () => initial),
    download: vi.fn(async () => initial),
    install: vi.fn(async () => true),
    setMode: vi.fn(async () => initial),
    onState: vi.fn(() => () => {}),
  };
}

async function renderWith(initial: DesktopUpdateState) {
  const api = bridge(initial);
  (window as TestWindow).electronAPI = { isElectron: true, updates: api };
  await act(async () => {
    render(<DesktopUpdatesCard />);
  });
  return api;
}

afterEach(() => {
  cleanup();
  delete (window as TestWindow).electronAPI;
});

describe("DesktopUpdatesCard", () => {
  it("renders nothing in the browser", () => {
    const { container } = render(<DesktopUpdatesCard />);
    expect(container.innerHTML).toBe("");
  });

  it("checks on demand", async () => {
    const api = await renderWith(state());
    fireEvent.click(screen.getByText("desktopUpdates.checkNow"));
    expect(api.check).toHaveBeenCalled();
  });

  it("offers the download in ask first mode", async () => {
    const api = await renderWith(
      state({ status: "available", version: "26.10.2" }),
    );
    fireEvent.click(screen.getByText("desktopUpdates.download"));
    expect(api.download).toHaveBeenCalled();
  });

  it("restarts into a downloaded update", async () => {
    const api = await renderWith(
      state({ status: "downloaded", version: "26.10.2" }),
    );
    fireEvent.click(screen.getByText("desktopUpdates.restart"));
    expect(api.install).toHaveBeenCalled();
  });

  it("links the release for installs that can not update", async () => {
    await renderWith(
      state({
        kind: "manual",
        status: "available",
        version: "26.10.2",
        releaseUrl: "https://example.com/r",
      }),
    );
    expect(
      screen.getByText("desktopUpdates.download").closest("a"),
    ).toHaveProperty("href", "https://example.com/r");
  });

  it("hides on dev builds", async () => {
    await renderWith(state({ kind: "disabled" }));
    expect(screen.queryByText("desktopUpdates.title")).toBeNull();
  });
});
