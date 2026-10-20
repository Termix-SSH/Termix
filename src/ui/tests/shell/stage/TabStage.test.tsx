import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";

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

import type { TabRenderProps } from "@/shell/tab-registry";
import { registerTabType } from "@/shell/tab-registry";
import {
  ShellControllerProvider,
  useShellController,
} from "@/shell/controller/ShellControllerProvider";
import type { ShellController } from "@/shell/controller/types";
import { TabPortals } from "@/shell/stage/TabPortals";
import { TabStage } from "@/shell/stage/TabStage";

afterEach(cleanup);

const mounts = { count: 0 };

function Probe({ tab }: TabRenderProps) {
  useEffect(() => {
    mounts.count += 1;
  }, []);
  return <div data-testid={`probe-${tab.id}`}>probe</div>;
}

registerTabType({
  id: "probe",
  component: Probe,
  hostless: true,
  multiInstance: true,
});

let shell: ShellController | null = null;

function Capture() {
  shell = useShellController();
  return null;
}

function Harness({ stage }: { stage: boolean }) {
  return (
    <ShellControllerProvider username="ada" onLogout={() => {}}>
      <Capture />
      {stage && <TabStage />}
      <TabPortals />
    </ShellControllerProvider>
  );
}

function Toggle() {
  const [stage, setStage] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setStage((v) => !v)}>
        toggle
      </button>
      <Harness stage={stage} />
    </>
  );
}

describe("TabStage", () => {
  it("never remounts a tab moved between inline, a pane and a new stage", async () => {
    mounts.count = 0;
    render(<Toggle />);
    await waitFor(() => expect(shell).not.toBeNull());

    let tabId = "";
    act(() => {
      tabId = shell!.tabs.openMultiInstance("probe");
    });
    const element = await screen.findByTestId(`probe-${tabId}`);
    const node = element.closest<HTMLElement>("div[style]")!;
    expect(mounts.count).toBe(1);
    expect(node.isConnected).toBe(true);

    // Into a split pane.
    act(() => {
      shell!.split.handleAction({ kind: "split", tabId, edge: "right" });
    });
    await waitFor(() =>
      expect(element.closest("[data-split-pane-id]")).not.toBeNull(),
    );
    expect(screen.getByTestId(`probe-${tabId}`)).toBe(element);

    // Back to the normal view.
    const splitId = shell!.split.active!.id;
    act(() => {
      shell!.split.handleAction({ kind: "unsplit", splitTabId: splitId });
    });
    await waitFor(() =>
      expect(element.closest("[data-split-pane-id]")).toBeNull(),
    );
    expect(screen.getByTestId(`probe-${tabId}`)).toBe(element);

    // The stage goes away (a layout swap) and comes back.
    act(() => screen.getByText("toggle").click());
    expect(element.isConnected).toBe(false);
    act(() => screen.getByText("toggle").click());
    await waitFor(() => expect(element.isConnected).toBe(true));

    expect(screen.getByTestId(`probe-${tabId}`)).toBe(element);
    expect(mounts.count).toBe(1);
  });

  it("shows only the active inline tab", async () => {
    render(<Harness stage />);
    await waitFor(() => expect(shell).not.toBeNull());
    let first = "";
    let second = "";
    act(() => {
      first = shell!.tabs.openMultiInstance("probe");
    });
    act(() => {
      second = shell!.tabs.openMultiInstance("probe");
    });
    const a = await screen.findByTestId(`probe-${first}`);
    const b = await screen.findByTestId(`probe-${second}`);
    const nodeOf = (el: HTMLElement) => el.closest<HTMLElement>("div[style]")!;
    expect(nodeOf(b).style.display).toBe("");
    expect(nodeOf(a).style.display).toBe("none");
  });
});
