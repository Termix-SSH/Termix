import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginSplitDrag,
  dropTargetAt,
  dropTargetRect,
  endSplitDrag,
  isSplitDragging,
  moveSplitDrag,
  setSplitDropHandler,
  setSplitDropHitTest,
} from "@/shell/split/split-drag";

const rect = { left: 0, top: 0, width: 200, height: 100 };

afterEach(() => endSplitDrag(false));

describe("dropTargetAt", () => {
  it("picks the nearest edge band, else the center", () => {
    expect(dropTargetAt(rect, 10, 50)).toBe("left");
    expect(dropTargetAt(rect, 190, 50)).toBe("right");
    expect(dropTargetAt(rect, 100, 5)).toBe("top");
    expect(dropTargetAt(rect, 100, 95)).toBe("bottom");
    expect(dropTargetAt(rect, 100, 50)).toBe("center");
  });
});

describe("dropTargetRect", () => {
  it("covers the half the new pane would take", () => {
    expect(dropTargetRect(rect, "right")).toEqual({
      left: 100,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(dropTargetRect(rect, "top")).toEqual({
      left: 0,
      top: 0,
      width: 200,
      height: 50,
    });
    expect(dropTargetRect(rect, "center")).toEqual(rect);
  });
});

describe("split drag", () => {
  it("drops on the hovered target when committed", () => {
    const hover = { paneId: "p1", target: "left" as const, rect };
    const disposeHit = setSplitDropHitTest(() => hover);
    const onDrop = vi.fn();
    const disposeDrop = setSplitDropHandler(onDrop);
    const source = { kind: "tab" as const, tabId: "t1", label: "web-01" };

    beginSplitDrag(source, 1, 1);
    moveSplitDrag(2, 2);
    expect(isSplitDragging()).toBe(true);
    endSplitDrag(true);

    expect(isSplitDragging()).toBe(false);
    expect(onDrop).toHaveBeenCalledWith(source, hover);
    disposeHit();
    disposeDrop();
  });

  it("does nothing when cancelled or over no target", () => {
    const disposeHit = setSplitDropHitTest(() => null);
    const onDrop = vi.fn();
    const disposeDrop = setSplitDropHandler(onDrop);
    beginSplitDrag({ kind: "tab", tabId: "t1", label: "x" }, 0, 0);
    endSplitDrag(true);
    expect(onDrop).not.toHaveBeenCalled();
    disposeHit();
    disposeDrop();
  });
});
