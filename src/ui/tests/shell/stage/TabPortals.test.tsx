import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

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
const lookApi = vi.hoisted(() => ({
  getLook: vi.fn(),
  saveUserLook: vi.fn(async () => {}),
  saveDefaultLook: vi.fn(),
}));
vi.mock("@/api/look-api", () => lookApi);
vi.mock("@/plugin-host/loader", () => ({
  retryPluginFrontend: vi.fn(async () => {}),
  syncPlugins: vi.fn(async () => {}),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import type { TabRenderProps } from "@/shell/tab-registry";
import { registerTabType, resetTabTypes } from "@/shell/tab-registry";
import {
  ShellControllerProvider,
  useShellController,
} from "@/shell/controller/ShellControllerProvider";
import type { ShellController } from "@/shell/controller/types";
import { TabPortals } from "@/shell/stage/TabPortals";
import { TabStage } from "@/shell/stage/TabStage";
import { LayoutHost } from "@/shell/layout/LayoutHost";
import { registerLayout, resetRegisteredLayouts } from "@/look/layout-registry";
import { chooseLayout, loadLook, resetLook } from "@/look/look-store";
import {
  markPluginsSettled,
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";

const mounts = { count: 0 };

/** Stands in for a terminal: a session id and scrollback that a remount would lose. */
function FakeTerminal({ tab }: TabRenderProps) {
  const session = useRef(`session-${Math.random().toString(36).slice(2)}`);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    mounts.count += 1;
  }, []);
  return (
    <div data-testid={`term-${tab.id}`} data-session={session.current}>
      <button type="button" onClick={() => setLines((l) => [...l, "line"])}>
        write {tab.id}
      </button>
      <pre>{lines.join("\n")}</pre>
    </div>
  );
}

let shell: ShellController | null = null;
function Capture() {
  shell = useShellController();
  return null;
}

// Two layouts that put the stage in very different places.
function RailLayout() {
  return (
    <div data-testid="rail-layout" className="flex">
      <nav>rail</nav>
      <main>
        <TabStage />
      </main>
    </div>
  );
}
function TopBarLayout() {
  return (
    <div data-testid="topbar-layout">
      <header>bar</header>
      <section>
        <div>
          <TabStage />
        </div>
      </section>
    </div>
  );
}

function App() {
  return (
    <ShellControllerProvider username="ada" onLogout={() => {}}>
      <Capture />
      <LayoutHost />
      <TabPortals />
    </ShellControllerProvider>
  );
}

beforeEach(async () => {
  mounts.count = 0;
  shell = null;
  resetLook();
  resetPluginStore();
  resetRegisteredLayouts();
  registerTabType({
    id: "fake-terminal",
    component: FakeTerminal,
    hostless: true,
    multiInstance: true,
  });
  registerLayout({ id: "rail", component: RailLayout });
  registerLayout({ id: "topbar", component: TopBarLayout });
  lookApi.getLook.mockResolvedValue({
    layoutId: "rail",
    themeId: null,
    defaults: { layout: null, theme: null },
    defaultLook: { layout: null, theme: null },
    safeLayout: false,
    unavailable: [],
  });
  await loadLook();
  setPluginSummaries([]);
  markPluginsSettled();
});

afterEach(() => {
  cleanup();
  resetTabTypes();
});

describe("TabPortals", () => {
  it("keeps three sessions and their scrollback through a split and a layout switch", async () => {
    render(<App />);
    await screen.findByTestId("rail-layout");
    await waitFor(() => expect(shell).not.toBeNull());

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        ids.push(shell!.tabs.openMultiInstance("fake-terminal"));
      });
    }
    const terms = await Promise.all(
      ids.map((id) => screen.findByTestId(`term-${id}`)),
    );
    const sessions = terms.map((el) => el.dataset.session);
    expect(mounts.count).toBe(3);

    // Some output in every terminal.
    for (const id of ids) act(() => screen.getByText(`write ${id}`).click());
    const scrollback = () =>
      terms.map((el) => el.querySelector("pre")!.textContent);
    expect(scrollback()).toEqual(["line", "line", "line"]);

    const check = () => {
      ids.forEach((id, index) => {
        const el = screen.getByTestId(`term-${id}`);
        expect(el).toBe(terms[index]);
        expect(el.dataset.session).toBe(sessions[index]);
      });
      expect(scrollback()).toEqual(["line", "line", "line"]);
      expect(mounts.count).toBe(3);
    };

    // The second one into a split, then back out.
    const moved = ids[1];
    act(() => {
      shell!.split.handleAction({ kind: "split", tabId: moved, edge: "right" });
    });
    await waitFor(() =>
      expect(terms[1].closest("[data-split-pane-id]")).not.toBeNull(),
    );
    check();
    const splitId = shell!.split.active!.id;
    act(() => {
      shell!.split.handleAction({ kind: "unsplit", splitTabId: splitId });
    });
    await waitFor(() =>
      expect(terms[1].closest("[data-split-pane-id]")).toBeNull(),
    );
    check();

    // Switch layouts and back.
    await act(() => chooseLayout("topbar"));
    const topbar = await screen.findByTestId("topbar-layout");
    await waitFor(() =>
      terms.forEach((el) => expect(topbar.contains(el)).toBe(true)),
    );
    expect(screen.queryByTestId("rail-layout")).toBeNull();
    check();

    await act(() => chooseLayout("rail"));
    const rail = await screen.findByTestId("rail-layout");
    await waitFor(() =>
      terms.forEach((el) => expect(rail.contains(el)).toBe(true)),
    );
    check();
  });
});
