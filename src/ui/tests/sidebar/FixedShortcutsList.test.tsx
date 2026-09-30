import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FixedShortcutsList,
  fixedShortcuts,
} from "@/sidebar/FixedShortcutsList";

describe("FixedShortcutsList", () => {
  it("lists every shell shortcut with its keys", () => {
    render(<FixedShortcutsList />);
    expect(
      screen.getByText("newUi.sidebar.keybindings.fixed.splitRight"),
    ).toBeTruthy();
    expect(screen.getAllByText("Shift").length).toBeGreaterThan(3);
    expect(fixedShortcuts().map((s) => s.labelKey)).toContain("jumpTab");
  });
});
