import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiPanelHint } from "../../sidebar/MultiPanelHint";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const STORAGE_KEY = "termix_multiPanelHintDismissed";

function renderHint(props: Partial<Parameters<typeof MultiPanelHint>[0]> = {}) {
  return render(
    <MultiPanelHint
      canPromote
      canRightDock
      onOpenAsTab={vi.fn()}
      onOpenInRightDock={vi.fn()}
      {...props}
    />,
  );
}

describe("MultiPanelHint", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows both actions to a user who has not dismissed it", () => {
    renderHint();
    expect(screen.getByText("nav.multiPanelHintTitle")).toBeTruthy();
    expect(screen.getByText("nav.openAsTab")).toBeTruthy();
    expect(screen.getByText("nav.openInRightDock")).toBeTruthy();
  });

  it("spells out how to do each action without the hint", () => {
    // The whole point of the hint is that the knowledge outlives it, so the
    // shortcut and the permanent button must both be named.
    const { container } = renderHint();
    expect(container.textContent).toContain("nav.multiPanelHintTabHow");
    expect(container.textContent).toContain("nav.multiPanelHintDockHow");
  });

  it("stays hidden once dismissed", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    renderHint();
    expect(screen.queryByText("nav.multiPanelHintTitle")).toBeNull();
  });

  it("hides and persists the choice when dismissed", async () => {
    const user = userEvent.setup();
    renderHint();
    await user.click(screen.getByLabelText("common.dismiss"));

    expect(screen.queryByText("nav.multiPanelHintTitle")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("renders nothing when the panel supports neither action", () => {
    renderHint({ canPromote: false, canRightDock: false });
    expect(screen.queryByText("nav.multiPanelHintTitle")).toBeNull();
  });

  it("only offers the actions the panel actually supports", () => {
    renderHint({ canPromote: false });
    expect(screen.queryByText("nav.openAsTab")).toBeNull();
    expect(screen.getByText("nav.openInRightDock")).toBeTruthy();
  });

  it("runs the action and dismisses so it does not come back", async () => {
    const user = userEvent.setup();
    const onOpenAsTab = vi.fn();
    renderHint({ onOpenAsTab });

    await user.click(screen.getByText("nav.openAsTab"));

    expect(onOpenAsTab).toHaveBeenCalledOnce();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });
});
