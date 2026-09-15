import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/electron", () => ({ isElectron: () => true }));

import { TabBar } from "@/shell/TabBar";

afterEach(cleanup);

const tabs = [
  { id: "dashboard", type: "dashboard", label: "Dashboard" },
  { id: "terminal-1", type: "terminal", label: "web-01" },
] as Tab[];

function renderTabBar(activeTabId: string, onSetActiveTab = vi.fn()) {
  return render(
    <TabBar
      tabs={tabs}
      activeTabId={activeTabId}
      splitMode="none"
      paneTabIds={[]}
      focusedPaneIndex={null}
      onSetActiveTab={onSetActiveTab}
      onCloseTab={() => {}}
      onRefreshTab={() => {}}
      onReorderTabs={() => {}}
      onSplitTab={() => {}}
      onAddToSplit={() => {}}
      onRemoveFromSplit={() => {}}
      isAppFullscreen={false}
      onToggleAppFullscreen={() => {}}
    />,
  );
}

describe("TabBar workspace continuity", () => {
  it("keeps one shared indicator on the active workspace", () => {
    const { container, rerender } = renderTabBar("dashboard");
    expect(
      container.querySelector('[data-workspace-indicator="dashboard"]'),
    ).toBeTruthy();

    rerender(
      <TabBar
        tabs={tabs}
        activeTabId="terminal-1"
        splitMode="none"
        paneTabIds={[]}
        focusedPaneIndex={null}
        onSetActiveTab={() => {}}
        onCloseTab={() => {}}
        onRefreshTab={() => {}}
        onReorderTabs={() => {}}
        onSplitTab={() => {}}
        onAddToSplit={() => {}}
        onRemoveFromSplit={() => {}}
        isAppFullscreen={false}
        onToggleAppFullscreen={() => {}}
      />,
    );

    expect(
      container.querySelectorAll("[data-workspace-indicator]"),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-workspace-indicator="terminal-1"]'),
    ).toBeTruthy();
  });

  it("activates a workspace immediately when its tab is clicked", () => {
    const onSetActiveTab = vi.fn();
    const { getByText } = renderTabBar("dashboard", onSetActiveTab);

    fireEvent.click(getByText("web-01"));

    expect(onSetActiveTab).toHaveBeenCalledWith("terminal-1");
  });
});
