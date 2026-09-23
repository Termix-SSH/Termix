import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";
import {
  resetPluginStore,
  setFrontendState,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import {
  unregisteredViewStatus,
  viewOwner,
} from "@/plugin-host/view-ownership";
import { renderTabContent } from "@/shell/tabUtils";
import {
  canRestoreTabType,
  isPersistentTabType,
  registerTabType,
  resetTabTypes,
} from "@/shell/tab-registry";
import {
  registerDashboardCard,
  resetDashboardCards,
} from "@/dashboard/dashboard-cards-registry";
import { PluginCardSlot } from "@/dashboard/DashboardTab";
import type { Host, Tab } from "@/types/ui-types";

const shell = {
  openTab: () => {},
  openSingletonTab: () => {},
  closeTab: () => {},
  renameTab: () => {},
  openFileInEditor: () => {},
  openFileManager: () => {},
  openTerminalTab: () => {},
  openRailView: () => {},
  closeRailView: () => {},
};

function owner(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "gizmo",
    name: "Gizmo",
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    contributes: {
      tabs: [
        { id: "gizmo-tab", titleKey: "t", icon: "Box", openFrom: ["rail"] },
      ],
      panels: [{ id: "gizmo-panel", titleKey: "t" }],
      dashboardCards: [{ id: "gizmo-card", titleKey: "t" }],
    },
    ...overrides,
  };
}

const savedTab: Tab = {
  id: "gizmo-1",
  instanceId: "gizmo-1",
  type: "gizmo-tab",
  label: "Gizmo",
  openedAt: 0,
  host: { id: "1", name: "web-01" } as Host,
};

afterEach(() => {
  resetPluginStore();
  resetTabTypes();
  resetDashboardCards();
});

describe("view ownership", () => {
  it("finds the owner of a tab, panel or card from its manifest", () => {
    setPluginSummaries([owner()]);
    expect(viewOwner("tab", "gizmo-tab")?.summary.id).toBe("gizmo");
    expect(viewOwner("panel", "gizmo-panel")?.summary.id).toBe("gizmo");
    // A tab id doubles as a panel when a rail panel is promoted.
    expect(viewOwner("panel", "gizmo-tab")?.summary.id).toBe("gizmo");
    expect(viewOwner("card", "gizmo-card")?.summary.id).toBe("gizmo");
    expect(viewOwner("tab", "someone-else")).toBeUndefined();
  });

  it("explains why a view is absent", () => {
    setPluginSummaries([owner({ enabled: false })]);
    expect(unregisteredViewStatus("tab", "gizmo-tab").status).toBe("disabled");

    setPluginSummaries([owner({ state: "failed" })]);
    expect(unregisteredViewStatus("tab", "gizmo-tab").status).toBe("failed");

    setPluginSummaries([owner()]);
    expect(unregisteredViewStatus("tab", "gizmo-tab").status).toBe("loading");
    setFrontendState("gizmo", "active");
    expect(unregisteredViewStatus("tab", "gizmo-tab").status).toBe("missing");

    expect(unregisteredViewStatus("tab", "nobody").status).toBe("missing");
  });

  it("keeps a saved tab of a disabled plugin and restores it as a placeholder", () => {
    setPluginSummaries([owner({ enabled: false })]);
    expect(isPersistentTabType("gizmo-tab")).toBe(true);
    expect(canRestoreTabType("gizmo-tab", savedTab.host)).toBe(true);

    render(<>{renderTabContent(savedTab, { shell })}</>);
    const placeholder = screen.getByTestId("plugin-view-placeholder");
    expect(placeholder.dataset.status).toBe("disabled");
    expect(placeholder.textContent).toContain("plugins.runtime.needsPlugin");
  });

  it("shows a not-installed placeholder for a tab nobody owns, without throwing", () => {
    setPluginSummaries([]);
    render(<>{renderTabContent({ ...savedTab, type: "gone" }, { shell })}</>);
    expect(screen.getByTestId("plugin-view-placeholder").dataset.status).toBe(
      "missing",
    );
  });

  it("swaps the placeholder for the real tab once the plugin registers it", () => {
    setPluginSummaries([owner()]);
    registerTabType({
      id: "gizmo-tab",
      pluginId: "gizmo",
      component: ({ host }) => <span>gizmo on {host?.name}</span>,
    });
    render(<>{renderTabContent(savedTab, { shell })}</>);
    expect(screen.getByText("gizmo on web-01")).toBeTruthy();
  });

  it("keeps a dashboard card's slot while its plugin is off", () => {
    setPluginSummaries([owner({ enabled: false })]);
    const view = render(
      <PluginCardSlot
        id="gizmo-card"
        isVisible
        onOpenSingletonTab={() => {}}
      />,
    );
    expect(screen.getByTestId("plugin-view-placeholder").dataset.status).toBe(
      "disabled",
    );

    act(() => {
      setPluginSummaries([owner()]);
      registerDashboardCard({
        id: "gizmo-card",
        pluginId: "gizmo",
        titleKey: "t",
        component: () => <span>gizmo card</span>,
      });
    });
    view.rerender(
      <PluginCardSlot
        id="gizmo-card"
        isVisible
        onOpenSingletonTab={() => {}}
      />,
    );
    expect(screen.getByText("gizmo card")).toBeTruthy();
  });
});
