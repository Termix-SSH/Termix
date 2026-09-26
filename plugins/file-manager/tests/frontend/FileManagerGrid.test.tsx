import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FileManagerGrid } from "../../src/frontend/FileManagerGrid";
import type { FileItem } from "../../src/frontend/host-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 29,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 29,
        size: 29,
      })),
    measureElement: () => {},
    measure: () => {},
  }),
}));

const file: FileItem = {
  name: "notes.txt",
  path: "/notes.txt",
  type: "file",
  modified: "2026-09-01",
  owner: "owner",
  permissions: "-rw-r--r--",
};
const props = {
  files: [file],
  selectedFiles: [file],
  viewMode: "list" as const,
  onFileOpen: vi.fn(),
  onSelectionChange: vi.fn(),
  onRefresh: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("remote file rename", () => {
  it.each(["F2", "F6"])("starts rename with %s in the visible pane", (key) => {
    vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(
      document.body,
    );
    const onStartEdit = vi.fn();
    render(<FileManagerGrid {...props} onStartEdit={onStartEdit} />);
    fireEvent.keyDown(document, { key });
    expect(onStartEdit).toHaveBeenCalledExactlyOnceWith(file);
  });

  it("does not rename files in a hidden pane", () => {
    vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(
      null,
    );
    const onStartEdit = vi.fn();
    render(<FileManagerGrid {...props} onStartEdit={onStartEdit} />);
    fireEvent.keyDown(document, { key: "F2" });
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("hides metadata while editing and commits the new name", () => {
    const onRename = vi.fn();
    const { rerender } = render(<FileManagerGrid {...props} />);
    expect(screen.getByText(file.modified!)).toBeInTheDocument();
    rerender(
      <FileManagerGrid
        {...props}
        density="compact"
        editingFile={file}
        onRename={onRename}
      />,
    );
    expect(screen.queryByText(file.modified!)).not.toBeInTheDocument();
    expect(screen.queryByText(file.permissions!)).not.toBeInTheDocument();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "renamed.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(file, "renamed.txt");
    rerender(<FileManagerGrid {...props} />);
    expect(screen.getByText(file.modified!)).toBeInTheDocument();
  });
});
