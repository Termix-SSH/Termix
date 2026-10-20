import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getUserInfo: vi.fn(async () => ({ is_admin: true })),
  getUserPreferences: vi.fn(async () => ({ reopenTabsOnLogin: false })),
  saveUserPreferences: vi.fn(async () => {}),
  getSSHHosts: vi.fn(async () => [] as unknown[]),
  getSSHFolders: vi.fn(async () => []),
  getOpenTabs: vi.fn(async () => []),
  getActiveSessions: vi.fn(async () => []),
  addOpenTab: vi.fn(async () => {}),
  deleteOpenTab: vi.fn(async () => {}),
  patchOpenTab: vi.fn(async () => {}),
  createSSHHost: vi.fn(async () => ({})),
}));
vi.mock("@/main-axios", () => api);

import {
  ShellControllerProvider,
  useShellController,
} from "@/shell/controller/ShellControllerProvider";
import { getShellController } from "@/shell/controller/shell-store";
import type { ShellController } from "@/shell/controller/types";
import { registerTabType, resetTabTypes } from "@/shell/tab-registry";
import {
  resetShellBridge,
  shell as bridgeShell,
} from "@/plugin-host/shell-bridge";

let shell: ShellController | null = null;
function Capture() {
  shell = useShellController();
  return null;
}

const logout = vi.fn();

function mount() {
  return render(
    <ShellControllerProvider username="ada" onLogout={logout}>
      <Capture />
    </ShellControllerProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  shell = null;
  logout.mockClear();
  registerTabType({
    id: "notes",
    component: () => null,
    hostless: true,
    multiInstance: true,
  });
});

afterEach(() => {
  cleanup();
  resetTabTypes();
  resetShellBridge();
});

describe("ShellControllerProvider", () => {
  it("starts on the dashboard and knows the user", async () => {
    mount();
    await waitFor(() => expect(shell?.isAdmin).toBe(true));
    expect(shell!.username).toBe("ada");
    expect(shell!.tabs.list.map((tab) => tab.id)).toEqual(["dashboard"]);
    expect(shell!.tabs.activeId).toBe("dashboard");
  });

  it("opens, renames and closes tabs, back to the dashboard", async () => {
    mount();
    await waitFor(() => expect(shell).not.toBeNull());
    let id = "";
    act(() => {
      id = shell!.tabs.openMultiInstance("notes");
    });
    expect(shell!.tabs.activeId).toBe(id);
    act(() => shell!.tabs.rename(id, "Mine"));
    expect(shell!.tabs.list.find((tab) => tab.id === id)?.label).toBe("Mine");
    await act(async () => {
      await shell!.tabs.close(id);
    });
    expect(shell!.tabs.list.map((tab) => tab.id)).toEqual(["dashboard"]);
    expect(shell!.tabs.activeId).toBe("dashboard");
  });

  it("opens the settings singleton once and passes the section on", async () => {
    mount();
    await waitFor(() => expect(shell).not.toBeNull());
    act(() => {
      shell!.tabs.openSingleton("settings");
    });
    act(() => {
      shell!.tabs.openSingleton("admin-settings");
    });
    const settings = shell!.tabs.list.filter((tab) => tab.id === "settings");
    expect(settings).toHaveLength(1);
    expect(settings[0].data).toMatchObject({ section: "admin-general" });
  });

  it("toggles the palette from the keyboard and the controller", async () => {
    mount();
    await waitFor(() => expect(shell).not.toBeNull());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }),
      );
    });
    expect(shell!.palette.isOpen).toBe(true);
    act(() => shell!.palette.close());
    expect(shell!.palette.isOpen).toBe(false);
  });

  it("publishes itself for plugins and the old bridge", async () => {
    mount();
    await waitFor(() => expect(getShellController()).not.toBeNull());
    act(() => bridgeShell.openSingletonTab("plugins"));
    await waitFor(() =>
      expect(shell!.tabs.list.some((tab) => tab.id === "plugins")).toBe(true),
    );
    act(() => bridgeShell.openRailView("credentials"));
    expect(shell!.regions.left).toMatchObject({
      view: "credentials",
      open: true,
    });
  });

  it("logs out on the logout event", async () => {
    mount();
    await waitFor(() => expect(shell).not.toBeNull());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("termix:logout", { detail: { manual: true } }),
      );
    });
    expect(logout).toHaveBeenCalledWith({ manual: true });
  });

  it("splits the active tab and closes the split", async () => {
    mount();
    await waitFor(() => expect(shell).not.toBeNull());
    let id = "";
    act(() => {
      id = shell!.tabs.openMultiInstance("notes");
    });
    act(() =>
      shell!.split.handleAction({ kind: "splitActive", edge: "right" }),
    );
    expect(shell!.split.active).not.toBeNull();
    expect(shell!.split.paneIdByTabId.has(id)).toBe(true);
    const splitId = shell!.split.active!.id;
    act(() =>
      shell!.split.handleAction({ kind: "unsplit", splitTabId: splitId }),
    );
    expect(shell!.split.active).toBeNull();
    expect(shell!.tabs.activeId).toBe(id);
  });
});
