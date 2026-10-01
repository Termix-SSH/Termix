import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderTabContent } from "@/shell/tabUtils";
import { registerPanel, resetPanels } from "@/shell/panel-registry";
import {
  registerTabType,
  resetTabTypes,
  type TabShellCallbacks,
} from "@/shell/tab-registry";
import {
  promotableIds,
  registerRailItem,
  resetRegisteredRailItems,
} from "@/sidebar/rail-items";
import type { Tab } from "@/types/ui-types";

const shell = {} as TabShellCallbacks;

function tabOf(type: string): Tab {
  return { id: type, instanceId: type, type, label: type } as Tab;
}

afterEach(() => {
  cleanup();
  resetPanels();
  resetTabTypes();
  resetRegisteredRailItems();
});

describe("renderTabContent", () => {
  it("shows a rail panel as a tab when no tab type is registered", () => {
    const Panel = vi.fn(({ placement }: { placement: string }) => (
      <div>panel in {placement}</div>
    ));
    registerPanel({ id: "history", component: Panel });

    render(<>{renderTabContent(tabOf("history"), { shell })}</>);

    expect(screen.getByText("panel in tab")).toBeInTheDocument();
  });

  it("prefers a registered tab type over the panel", () => {
    registerPanel({ id: "ai", component: () => <div>panel</div> });
    registerTabType({ id: "ai", component: () => <div>tab</div> });

    render(<>{renderTabContent(tabOf("ai"), { shell })}</>);

    expect(screen.getByText("tab")).toBeInTheDocument();
    expect(screen.queryByText("panel")).toBeNull();
  });
});

describe("promotableIds", () => {
  it("only offers items that have a tab or a panel to show", () => {
    registerRailItem({
      id: "history",
      icon: () => null,
      labelKey: "x",
      promotable: true,
    } as never);
    registerRailItem({
      id: "orphan",
      icon: () => null,
      labelKey: "x",
      promotable: true,
    } as never);
    registerPanel({ id: "history", component: () => null });

    expect(promotableIds()).toContain("history");
    expect(promotableIds()).not.toContain("orphan");
  });
});
