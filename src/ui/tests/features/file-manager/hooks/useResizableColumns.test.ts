import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useResizableColumns } from "@/features/file-manager/hooks/useResizableColumns";

const columns = [
  { key: "modified", defaultWidth: 120, minWidth: 70 },
  { key: "size", defaultWidth: 80, minWidth: 56, maxWidth: 200 },
];
const STORAGE_KEY = "test:columns";

function mouse(type: string, clientX: number) {
  document.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));
}

describe("useResizableColumns", () => {
  beforeEach(() => localStorage.clear());

  it("starts from defaults and builds a grid template with a flexible name column", () => {
    const { result } = renderHook(() =>
      useResizableColumns({ storageKey: STORAGE_KEY, columns }),
    );
    expect(result.current.gridTemplateColumns).toBe(
      "minmax(0, 1fr) 120px 80px",
    );
  });

  it("widens a column when its left-edge handle is dragged left and persists", () => {
    const { result } = renderHook(() =>
      useResizableColumns({ storageKey: STORAGE_KEY, columns }),
    );
    const handle = result.current.getHandleProps("size");
    act(() => {
      handle.onMouseDown({
        clientX: 500,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as React.MouseEvent);
    });
    expect(result.current.resizingKey).toBe("size");
    act(() => mouse("mousemove", 460));
    expect(result.current.widths.size).toBe(120);
    act(() => mouse("mouseup", 460));
    expect(result.current.resizingKey).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      modified: 120,
      size: 120,
    });
  });

  it("clamps to min/max and restores stored widths", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ modified: 10, size: 9999, junk: "x" }),
    );
    const { result } = renderHook(() =>
      useResizableColumns({ storageKey: STORAGE_KEY, columns }),
    );
    expect(result.current.widths).toEqual({ modified: 70, size: 200 });
  });

  it("resets a column to its default on double click", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ modified: 150 }));
    const { result } = renderHook(() =>
      useResizableColumns({ storageKey: STORAGE_KEY, columns }),
    );
    expect(result.current.widths.modified).toBe(150);
    act(() => {
      result.current.getHandleProps("modified").onDoubleClick({
        preventDefault() {},
        stopPropagation() {},
      } as unknown as React.MouseEvent);
    });
    expect(result.current.widths.modified).toBe(120);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).modified).toBe(120);
  });
});
