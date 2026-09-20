/**
 * Validates the plugin extension seam introduced for a future plugin loader:
 * registerRailItem/unregisterRailItem in rail-items.ts, and
 * registerTabComponent/unregisterTabComponent in tabUtils.tsx.
 *
 * This does NOT test a real feature. There is no plugin loader yet -- this
 * registers a fake rail item and a fake tab component, confirms they render
 * through the normal AppRail/tab-content paths, then unregisters them. If
 * this test ever needs deleting because the seam changed shape, that's fine;
 * it exists to prove the seam works, not to protect a shipped feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Puzzle } from "lucide-react";
import {
  registerRailItem,
  unregisterRailItem,
  visibleRailItems,
} from "@/sidebar/rail-items";
import {
  registerTabComponent,
  unregisterTabComponent,
  renderTabContent,
} from "@/shell/tabUtils";
import { AppRail } from "@/sidebar/AppRail";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/api/alerts-api", () => ({
  getAlertFirings: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/hooks/use-ai-availability", () => ({
  useAiAvailability: () => ({ userEnabled: false }),
}));

const FAKE_TAB_ID = "__test_plugin_tab__";

function FakePluginTabComponent({ tab }: { tab: Tab }) {
  return <div data-testid="fake-plugin-tab">plugin tab for {tab.id}</div>;
}

describe("plugin extension seam", () => {
  afterEach(() => {
    unregisterRailItem(FAKE_TAB_ID);
    unregisterTabComponent(FAKE_TAB_ID);
  });

  it("merges a runtime-registered rail item into visibleRailItems", () => {
    expect(visibleRailItems().map((i) => i.id)).not.toContain(FAKE_TAB_ID);

    registerRailItem({
      id: FAKE_TAB_ID,
      icon: Puzzle,
      labelKey: "nav.fakePluginItem",
      kind: "tab",
    });

    expect(visibleRailItems().map((i) => i.id)).toContain(FAKE_TAB_ID);

    unregisterRailItem(FAKE_TAB_ID);
    expect(visibleRailItems().map((i) => i.id)).not.toContain(FAKE_TAB_ID);
  });

  it("renders a registered rail item as a clickable button in AppRail", async () => {
    registerRailItem({
      id: FAKE_TAB_ID,
      icon: Puzzle,
      labelKey: "nav.fakePluginItem",
      kind: "tab",
    });

    const onOpenTab = vi.fn();
    render(
      <AppRail
        railView="hosts"
        sidebarOpen={false}
        splitMode="none"
        username="test"
        isAdmin={false}
        onRailClick={vi.fn()}
        onOpenTab={onOpenTab}
        onLogout={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByText("nav.fakePluginItem"));
    screen.getByText("nav.fakePluginItem").closest("button")?.click();
    expect(onOpenTab).toHaveBeenCalledWith(FAKE_TAB_ID);
  });

  it("opens a registered plugin tab id through the tab-component registry", async () => {
    const loader = vi.fn().mockResolvedValue({
      default: FakePluginTabComponent,
    });
    registerTabComponent(FAKE_TAB_ID, loader);

    const tab: Tab = {
      id: "tab-1",
      instanceId: "instance-1",
      type: FAKE_TAB_ID,
      label: "Fake plugin tab",
      openedAt: Date.now(),
    };

    const content = renderTabContent(tab);
    render(<>{content}</>);

    await waitFor(() =>
      expect(screen.getByTestId("fake-plugin-tab")).toBeTruthy(),
    );
    expect(loader).toHaveBeenCalledOnce();

    unregisterTabComponent(FAKE_TAB_ID);
  });

  it("renders nothing for an unregistered plugin tab id", () => {
    const tab: Tab = {
      id: "tab-2",
      instanceId: "instance-2",
      type: "__totally_unknown_tab_type__",
      label: "Unknown tab",
      openedAt: Date.now(),
    };

    expect(renderTabContent(tab)).toBeNull();
  });
});
