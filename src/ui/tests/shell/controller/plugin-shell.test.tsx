import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ShellController as PluginShell } from "@termix-ssh/plugin-sdk/frontend";

vi.mock("@/main-axios", () => ({
  getUserInfo: vi.fn(async () => ({ is_admin: false })),
  getUserPreferences: vi.fn(async () => ({ reopenTabsOnLogin: false })),
  saveUserPreferences: vi.fn(async () => {}),
  getSSHHosts: vi.fn(async () => []),
  getSSHFolders: vi.fn(async () => []),
  getOpenTabs: vi.fn(async () => []),
  getActiveSessions: vi.fn(async () => []),
  addOpenTab: vi.fn(async () => {}),
  deleteOpenTab: vi.fn(async () => {}),
  patchOpenTab: vi.fn(async () => {}),
  createSSHHost: vi.fn(async () => ({})),
}));
vi.mock("@/hooks/use-sync-status", () => ({
  useSyncStatus: () => undefined,
  useSyncAttentionCount: () => 0,
}));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    permissions: ["hosts.view"],
    isAdmin: false,
    loaded: true,
    has: () => true,
  }),
}));

import { ShellControllerProvider } from "@/shell/controller/ShellControllerProvider";
import { usePluginShell } from "@/shell/controller/plugin-shell";

afterEach(cleanup);

let shell: PluginShell | null = null;
function Capture() {
  shell = usePluginShell("my-layout");
  return null;
}

describe("usePluginShell", () => {
  it("gives a layout the live shell", async () => {
    render(
      <ShellControllerProvider username="ada" onLogout={() => {}}>
        <Capture />
      </ShellControllerProvider>,
    );
    await waitFor(() => expect(shell).not.toBeNull());
    expect(shell!.env).toMatchObject({
      user: { username: "ada", isAdmin: false },
      permissions: ["hosts.view"],
      isElectron: false,
    });
    expect(shell!.tabs.activeId).toBe("dashboard");
    expect(typeof shell!.registries.useRailItems).toBe("function");

    act(() => shell!.actions.openSingletonTab("settings"));
    await waitFor(() => expect(shell!.tabs.activeId).toBe("settings"));

    act(() => shell!.regions.railClick("credentials"));
    expect(shell!.regions.left).toMatchObject({
      view: "credentials",
      open: true,
    });

    act(() => shell!.palette.open());
    expect(shell!.palette.isOpen).toBe(true);
  });
});
