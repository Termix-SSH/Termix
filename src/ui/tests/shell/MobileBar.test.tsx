import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Bell, Boxes } from "lucide-react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ has: () => true, loaded: true }),
}));
vi.mock("@/main-axios", () => ({
  getUserPreferences: vi.fn(async () => ({})),
  saveUserPreferences: vi.fn(async () => undefined),
}));

import { MobileBar, pickPrimaryItems } from "@/shell/MobileBar";
import {
  RAIL_ITEMS,
  registerRailItem,
  resetRegisteredRailItems,
} from "@/sidebar/rail-items";

afterEach(() => {
  cleanup();
  resetRegisteredRailItems();
  localStorage.clear();
  delete (window as { IS_ELECTRON?: boolean }).IS_ELECTRON;
});

function renderBar(onRailClick = vi.fn()) {
  render(
    <MobileBar
      railView="hosts"
      sidebarOpen={false}
      username="alice"
      onRailClick={onRailClick}
      onOpenTab={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenPalette={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  return onRailClick;
}

describe("MobileBar", () => {
  it("puts flagged items first and caps the bar at four", () => {
    const ids = pickPrimaryItems(RAIL_ITEMS).map((item) => item.id);
    expect(ids.slice(0, 2)).toEqual(["hosts", "quick-connect"]);
    expect(ids).toHaveLength(4);
  });

  it("opens a destination from the bar", () => {
    const onRailClick = renderBar();
    fireEvent.click(screen.getByLabelText("nav.hosts"));
    expect(onRailClick).toHaveBeenCalledWith("hosts");
  });

  it("lists footer items and settings behind More", () => {
    registerRailItem({
      id: "inbox",
      icon: Bell,
      labelKey: "test.inbox",
      placement: "footer",
      pluginId: "demo",
    });
    registerRailItem({
      id: "boxes",
      icon: Boxes,
      labelKey: "test.boxes",
      group: "objects",
      pluginId: "demo",
    });
    renderBar();
    fireEvent.click(screen.getByLabelText("common.more"));
    expect(screen.getByText("test.inbox")).toBeTruthy();
    expect(screen.getByText("nav.settings")).toBeTruthy();
    expect(screen.getByText("nav.group.objects")).toBeTruthy();
  });

  it("leaves logout out of More on the desktop", () => {
    renderBar();
    fireEvent.click(screen.getByLabelText("common.more"));
    expect(screen.getByText("common.logout")).toBeTruthy();
    cleanup();
    (window as { IS_ELECTRON?: boolean }).IS_ELECTRON = true;
    renderBar();
    fireEvent.click(screen.getByLabelText("common.more"));
    expect(screen.queryByText("common.logout")).toBeNull();
  });

  it("leaves out hidden items", () => {
    localStorage.setItem("hiddenRailTabs", JSON.stringify(["hosts"]));
    renderBar();
    expect(screen.queryByLabelText("nav.hosts")).toBeNull();
  });
});
