import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type { ActiveSessionInfo } from "@/api/open-tabs-api";

const mainAxios = vi.hoisted(() => ({
  getActiveSessions: vi.fn(async () => [] as ActiveSessionInfo[]),
  deleteOpenTab: vi.fn(async () => {}),
}));

vi.mock("@/main-axios", () => mainAxios);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import { ConnectionsPanel } from "../../sidebar/ConnectionsPanel";
import {
  registerSlotContribution,
  resetActionRegistry,
} from "../../shell/action-registry";

beforeEach(() => {
  mainAxios.getActiveSessions.mockReset();
  mainAxios.getActiveSessions.mockResolvedValue([]);
  mainAxios.deleteOpenTab.mockReset();
  resetActionRegistry();
});

afterEach(() => {
  cleanup();
});

function renderPanel() {
  return render(
    <ConnectionsPanel
      tabs={[]}
      activeTabId=""
      allHosts={[]}
      backgroundTabRecords={[]}
      onSwitchToTab={() => {}}
      onCloseTab={() => {}}
      onReopenTab={() => {}}
      onForgetBackground={() => {}}
    />,
  );
}

describe("ConnectionsPanel - plugin sections", () => {
  it("renders what plugins add to connections.sections, even with no tabs", async () => {
    const Section = vi.fn(({ search }: { search?: string }) => (
      <div>plugin section {JSON.stringify(search)}</div>
    ));
    registerSlotContribution("connections.sections", {
      actionId: "demo.section",
      titleKey: "demo.section",
      kind: "component",
      component: Section as never,
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('plugin section ""')).toBeTruthy();
    });
    expect(screen.getByText("connections.noConnections")).toBeTruthy();
  });

  it("renders only the empty state without plugin sections", async () => {
    renderPanel();
    await waitFor(() => {
      expect(mainAxios.getActiveSessions).toHaveBeenCalled();
    });
    expect(screen.getByText("connections.noConnections")).toBeTruthy();
  });
});
