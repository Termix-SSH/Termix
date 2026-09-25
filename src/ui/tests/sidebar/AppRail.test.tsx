import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bell, Boxes } from "lucide-react";
import { AppRail } from "../../sidebar/AppRail";
import { RailBadge } from "../../sidebar/RailBadge";
import {
  registerRailItem,
  resetRegisteredRailItems,
} from "../../sidebar/rail-items";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ has: () => true, loaded: true }),
}));

afterEach(() => {
  resetRegisteredRailItems();
  localStorage.clear();
});

function renderRail(onRailClick = vi.fn()) {
  render(
    <AppRail
      railView="hosts"
      sidebarOpen={false}
      splitMode="none"
      username="alice"
      isAdmin={false}
      onRailClick={onRailClick}
      onLogout={vi.fn()}
    />,
  );
  return onRailClick;
}

describe("AppRail", () => {
  it("puts a footer item above the profile with its badge", async () => {
    registerRailItem({
      id: "inbox",
      icon: Bell,
      labelKey: "test.inbox",
      placement: "footer",
      useBadge: () => 3,
      pluginId: "demo",
    });
    registerRailItem({
      id: "boxes",
      icon: Boxes,
      labelKey: "test.boxes",
      pluginId: "demo",
    });
    const onRailClick = renderRail();

    const inbox = screen.getByTitle("test.inbox");
    const profile = screen.getAllByTitle("nav.userProfile")[0];
    const boxes = screen.getByTitle("test.boxes");
    // Footer items render after the main list and before the profile.
    expect(
      boxes.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      inbox.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(inbox.textContent).toContain("3");

    await userEvent.click(inbox);
    expect(onRailClick).toHaveBeenCalledWith("inbox");
  });

  it("hides a footer item the user hid from Navigation", () => {
    localStorage.setItem("hiddenRailTabs", JSON.stringify(["inbox"]));
    registerRailItem({
      id: "inbox",
      icon: Bell,
      labelKey: "test.inbox",
      placement: "footer",
      pluginId: "demo",
    });
    renderRail();
    expect(screen.queryByTitle("test.inbox")).toBeNull();
  });
});

describe("RailBadge", () => {
  it("shows nothing for zero", () => {
    const { container } = render(<RailBadge useBadge={() => 0} />);
    expect(container.textContent).toBe("");
  });

  it("caps a large count", () => {
    render(<RailBadge useBadge={() => 150} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });
});
