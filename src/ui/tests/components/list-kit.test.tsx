import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  AddButton,
  FormFooter,
  ListRow,
  ListRowAction,
  ListRowFolder,
  PanelList,
} from "@/components/list-kit";

afterEach(cleanup);

describe("ListRow", () => {
  it("tints odd rows and marks the selected one", () => {
    const { container, rerender } = render(<ListRow title="a" stripe={1} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("bg-muted/15");

    rerender(<ListRow title="a" stripe={1} selected />);
    expect(row.className).toContain("bg-accent-brand/10");
    expect(row.getAttribute("data-selected")).toBe("true");
  });

  it("clicks and opens with Enter, but tray clicks do not reach the row", () => {
    const onClick = vi.fn();
    const onAction = vi.fn();
    render(
      <ListRow
        title="web"
        onClick={onClick}
        actions={
          <ListRowAction label="Edit" onClick={onAction}>
            <span />
          </ListRowAction>
        }
      />,
    );
    const row = screen.getByRole("button", { name: /web/ });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("Edit"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the tray visible while active", () => {
    render(
      <ListRow
        title="a"
        active
        actions={
          <ListRowAction label="More">
            <span />
          </ListRowAction>
        }
      />,
    );
    const tray = screen.getByLabelText("More").parentElement as HTMLElement;
    expect(tray.className).toMatch(/(^| )flex( |$)/);
    expect(tray.className).not.toContain("hidden");
  });
});

describe("ListRowFolder", () => {
  it("toggles and shows the empty text when open with no items", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ListRowFolder
        name="Prod"
        count={0}
        open={false}
        onToggle={onToggle}
        emptyText="Nothing here"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Prod/ }));
    expect(onToggle).toHaveBeenCalled();
    expect(screen.queryByText("Nothing here")).toBeNull();

    rerender(
      <ListRowFolder
        name="Prod"
        count={0}
        open
        onToggle={onToggle}
        emptyText="Nothing here"
      />,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});

describe("PanelList", () => {
  it("shows the empty slot only without rows", () => {
    const { rerender } = render(
      <PanelList empty={<span>empty</span>}>{[false, null]}</PanelList>,
    );
    expect(screen.getByText("empty")).toBeTruthy();
    rerender(
      <PanelList empty={<span>empty</span>}>
        <ListRow title="row" />
      </PanelList>,
    );
    expect(screen.queryByText("empty")).toBeNull();
  });
});

describe("AddButton", () => {
  it("defaults its label and hides it when compact", () => {
    const { rerender } = render(<AddButton />);
    expect(screen.getByText("common.new")).toBeTruthy();
    rerender(<AddButton compact label="Add host" />);
    expect(screen.queryByText("Add host")).toBeNull();
    expect(screen.getByLabelText("Add host")).toBeTruthy();
  });
});

describe("FormFooter", () => {
  it("shows the unsaved note, delete and a saving state", () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const { rerender } = render(
      <FormFooter
        dirty
        onSave={onSave}
        onCancel={() => {}}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText("common.unsavedChanges")).toBeTruthy();
    fireEvent.click(screen.getByText("common.delete"));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByText("common.save"));
    expect(onSave).toHaveBeenCalled();

    rerender(<FormFooter saving onSave={onSave} />);
    const saving = screen.getByText("common.saving").closest("button");
    expect(saving?.disabled).toBe(true);
  });

  it("lets a status replace the unsaved note", () => {
    render(<FormFooter dirty status="2 errors" onSave={() => {}} />);
    expect(screen.getByText("2 errors")).toBeTruthy();
    expect(screen.queryByText("common.unsavedChanges")).toBeNull();
  });
});
