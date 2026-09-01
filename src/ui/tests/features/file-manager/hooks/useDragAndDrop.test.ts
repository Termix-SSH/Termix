import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDragAndDrop } from "../../../../features/file-manager/hooks/useDragAndDrop.js";

function makeEntry(name: string, isDirectory: boolean) {
  return { name, isDirectory, isFile: !isDirectory } as FileSystemEntry;
}

function makeDropEvent(entries: FileSystemEntry[], files: File[] = []) {
  const items = entries.map((entry) => ({
    webkitGetAsEntry: () => entry,
  }));

  const dataTransfer = {
    items,
    files: Object.assign(files, { item: (i: number) => files[i] }),
  };

  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  } as unknown as React.DragEvent;
}

describe("useDragAndDrop", () => {
  it("hands directory entries to onItemsDropped", () => {
    const onItemsDropped = vi.fn();
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped, onItemsDropped }),
    );

    const dir = makeEntry("myfolder", true);
    act(() => result.current.dragHandlers.onDrop(makeDropEvent([dir])));

    expect(onItemsDropped).toHaveBeenCalledWith([dir]);
    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it("reads entries before state updates clear dataTransfer", () => {
    const onItemsDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped: vi.fn(), onItemsDropped }),
    );

    const dir = makeEntry("myfolder", true);
    const event = makeDropEvent([dir]);

    // Mimic the browser neutering dataTransfer once the handler unwinds.
    act(() => {
      result.current.dragHandlers.onDrop(event);
      (event.dataTransfer as unknown as { items: unknown[] }).items = [];
    });

    expect(onItemsDropped).toHaveBeenCalledWith([dir]);
  });

  it("falls back to plain file upload when no directory is dropped", () => {
    const onFilesDropped = vi.fn();
    const onItemsDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped, onItemsDropped }),
    );

    const file = new File(["hi"], "a.txt");
    act(() =>
      result.current.dragHandlers.onDrop(
        makeDropEvent([makeEntry("a.txt", false)], [file]),
      ),
    );

    expect(onItemsDropped).not.toHaveBeenCalled();
    expect(onFilesDropped).toHaveBeenCalled();
  });

  it("rejects files over the size limit", () => {
    const onError = vi.fn();
    const onFilesDropped = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop({ onFilesDropped, onError, maxFileSize: 1 }),
    );

    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });

    act(() => result.current.dragHandlers.onDrop(makeDropEvent([], [big])));

    expect(onFilesDropped).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});
