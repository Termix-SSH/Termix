import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileSelection } from "./useFileSelection.js";

type FileItem = {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
};

const f = (name: string): FileItem => ({
  name,
  type: "file",
  path: `/dir/${name}`,
});

describe("useFileSelection", () => {
  it("single-selects, replacing prior selection", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.selectFile(f("a")));
    act(() => result.current.selectFile(f("b")));
    expect(result.current.selectedFiles.map((x) => x.name)).toEqual(["b"]);
    expect(result.current.getSelectedCount()).toBe(1);
  });

  it("multi-selects and toggles off on repeat", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.selectFile(f("a"), true));
    act(() => result.current.selectFile(f("b"), true));
    expect(result.current.getSelectedCount()).toBe(2);
    act(() => result.current.selectFile(f("a"), true));
    expect(result.current.selectedFiles.map((x) => x.name)).toEqual(["b"]);
  });

  it("reports isSelected by path", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.selectFile(f("a")));
    expect(result.current.isSelected(f("a"))).toBe(true);
    expect(result.current.isSelected(f("z"))).toBe(false);
  });

  it("selects a contiguous range regardless of direction", () => {
    const { result } = renderHook(() => useFileSelection());
    const files = [f("a"), f("b"), f("c"), f("d")];
    act(() => result.current.selectRange(files, files[3], files[1]));
    expect(result.current.selectedFiles.map((x) => x.name)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("selects all and clears", () => {
    const { result } = renderHook(() => useFileSelection());
    const files = [f("a"), f("b")];
    act(() => result.current.selectAll(files));
    expect(result.current.getSelectedCount()).toBe(2);
    act(() => result.current.clearSelection());
    expect(result.current.getSelectedCount()).toBe(0);
  });

  it("toggleSelection adds then removes", () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => result.current.toggleSelection(f("a")));
    expect(result.current.isSelected(f("a"))).toBe(true);
    act(() => result.current.toggleSelection(f("a")));
    expect(result.current.isSelected(f("a"))).toBe(false);
  });
});
