import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHostSpeedSearch } from "@/sidebar/tree/hooks/useHostSpeedSearch";

function SearchList({ activate }: { activate: (index: number) => void }) {
  const search = useHostSpeedSearch();
  return (
    <div
      data-testid="list"
      tabIndex={0}
      onKeyDown={(event) =>
        search.onKeyDown(
          event,
          search.text === "missing" ? 0 : 2,
          activate,
          () => {},
        )
      }
    >
      <input aria-label="unrelated editor" />
      <div
        contentEditable
        suppressContentEditableWarning
        data-testid="editable"
      />
      {search.open && (
        <input
          aria-label="search"
          ref={search.inputRef}
          value={search.text}
          onChange={(event) => search.change(event.target.value)}
        />
      )}
      <span data-testid="selection">{search.index}</span>
    </div>
  );
}

describe("host speed search keyboard", () => {
  it("starts from typing, navigates matches and closes with Escape", () => {
    const activate = vi.fn();
    render(<SearchList activate={activate} />);
    fireEvent.keyDown(screen.getByTestId("list"), { key: "a" });
    const input = screen.getByLabelText("search");
    expect((input as HTMLInputElement).value).toBe("a");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(activate).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("selection").textContent).toBe("0");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByTestId("selection").textContent).toBe("1");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("search")).toBeNull();
  });

  it("accepts committed IME text without treating composition Enter as connect", () => {
    const activate = vi.fn();
    render(<SearchList activate={activate} />);
    fireEvent.keyDown(screen.getByTestId("list"), { key: "/" });
    const input = screen.getByLabelText("search");
    fireEvent.change(input, { target: { value: "服务器" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(activate).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("服务器");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(activate).toHaveBeenCalledWith(0);
  });

  it("ignores other editors and modified shortcuts", () => {
    render(<SearchList activate={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("unrelated editor"), { key: "a" });
    fireEvent.keyDown(screen.getByTestId("editable"), { key: "b" });
    fireEvent.keyDown(screen.getByTestId("list"), { key: "c", ctrlKey: true });
    expect(screen.queryByLabelText("search")).toBeNull();
  });

  it("resets selection after editing and does not open anything with no matches", () => {
    const activate = vi.fn();
    render(<SearchList activate={activate} />);
    fireEvent.keyDown(screen.getByTestId("list"), { key: "/" });
    const input = screen.getByLabelText("search");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "missing" } });
    expect(screen.getByTestId("selection").textContent).toBe("0");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(activate).not.toHaveBeenCalled();
  });
});
