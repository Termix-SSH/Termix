import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  TilePicker,
  type TilePickerEntry,
} from "../../../components/tile-grid/TilePicker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const entry = (group: string, title: string): TilePickerEntry => ({
  id: `${group}-${title}`,
  title,
  group,
  kind: "card",
});

describe("TilePicker", () => {
  it("keeps a few groups open", () => {
    render(
      <TilePicker
        entries={[entry("Docker", "Containers"), entry("Alerts", "Firing")]}
        onAdd={() => {}}
      />,
    );
    expect(screen.getByText("Containers")).toBeTruthy();
    expect(screen.getByText("Firing")).toBeTruthy();
  });

  it("folds every group when there are many, and opens one on click", () => {
    const groups = ["A", "B", "C", "D", "E"];
    render(
      <TilePicker
        entries={groups.map((group) => entry(group, `${group} card`))}
        onAdd={() => {}}
      />,
    );
    for (const group of groups)
      expect(screen.queryByText(`${group} card`)).toBeNull();
    fireEvent.click(screen.getByText("C"));
    expect(screen.getByText("C card")).toBeTruthy();
    expect(screen.queryByText("D card")).toBeNull();
  });

  it("shows every match while searching", () => {
    const groups = ["A", "B", "C", "D", "E"];
    render(
      <TilePicker
        entries={groups.map((group) => entry(group, `${group} card`))}
        onAdd={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("tileGrid.search"), {
      target: { value: "card" },
    });
    for (const group of groups)
      expect(screen.getByText(`${group} card`)).toBeTruthy();
  });
});
