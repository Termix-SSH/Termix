import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FileManagerToolbar } from "../../src/frontend/FileManagerToolbar";

const props: React.ComponentProps<typeof FileManagerToolbar> = {
  t: (key) => key,
  currentPath: "/home/alice",
  navIndex: 0,
  navHistoryLength: 1,
  isLoading: false,
  sshSessionId: "session",
  selectedFiles: [],
  searchQuery: "report",
  setSearchQuery: vi.fn(),
  viewMode: "list",
  setViewMode: vi.fn(),
  density: "comfortable",
  setDensity: vi.fn(),
  sortBy: "name",
  setSortBy: vi.fn(),
  sortOrder: "asc",
  setSortOrder: vi.fn(),
  setMobileSidebarOpen: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  goUp: vi.fn(),
  navigateTo: vi.fn(),
  handleRefreshDirectory: vi.fn(),
  handleDeleteFiles: vi.fn(),
  handleCopyFiles: vi.fn(),
  handleFilesDropped: vi.fn(),
  handleCreateNewFolder: vi.fn(),
  handleCreateNewFile: vi.fn(),
};

function toolbar(visible = true) {
  const view = render(<FileManagerToolbar {...props} />);
  const input = view.getByPlaceholderText(
    "fileManager.searchFiles",
  ) as HTMLInputElement;
  Object.defineProperty(input, "checkVisibility", { value: () => visible });
  return { ...view, input };
}

afterEach(cleanup);

describe("file search shortcut", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "focuses and selects the search query with %j",
    (modifier) => {
      const { input } = toolbar();
      expect(fireEvent.keyDown(document, { key: "f", ...modifier })).toBe(
        false,
      );
      expect(input).toHaveFocus();
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
    },
  );

  it("does not handle the shortcut in a hidden tab", () => {
    const { input } = toolbar(false);
    expect(fireEvent.keyDown(document, { key: "f", ctrlKey: true })).toBe(true);
    expect(input).not.toHaveFocus();
  });

  it("leaves editor and dialog shortcuts alone", () => {
    const { input } = toolbar();
    render(
      <>
        <textarea aria-label="editor" />
        <div role="dialog">
          <button>Dialog action</button>
        </div>
      </>,
    );
    for (const target of [
      screen.getByLabelText("editor"),
      screen.getByText("Dialog action"),
    ]) {
      target.focus();
      expect(fireEvent.keyDown(target, { key: "f", ctrlKey: true })).toBe(true);
      expect(target).toHaveFocus();
      expect(input).not.toHaveFocus();
    }
  });

  it("does not intercept unmodified or already handled keys", () => {
    const { input } = toolbar();
    fireEvent.keyDown(document, { key: "f" });
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      cancelable: true,
    });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(input).not.toHaveFocus();
  });
});
