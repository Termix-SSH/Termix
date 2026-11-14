import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canScroll, focusEdge, watchEdges } from "@/plugin-frame/frame-edges";

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  document.body.innerHTML =
    "<button id='a'>a</button><input id='b' /><button id='c'>c</button>";
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("view edges", () => {
  it("focuses the first or last control when focus comes in", () => {
    const out = vi.fn();
    focusEdge("first", out);
    expect(document.activeElement?.id).toBe("a");
    focusEdge("last", out);
    expect(document.activeElement?.id).toBe("c");
    expect(out).not.toHaveBeenCalled();
  });

  it("passes focus on when there is nothing to focus", () => {
    document.body.innerHTML = "<p>text</p>";
    const out = vi.fn();
    focusEdge("first", out);
    expect(out).toHaveBeenCalledWith("next");
    focusEdge("last", out);
    expect(out).toHaveBeenCalledWith("prev");
  });

  it("knows when nothing under the pointer can scroll", () => {
    const box = document.createElement("div");
    box.style.overflowY = "auto";
    Object.defineProperty(box, "scrollHeight", { value: 400 });
    Object.defineProperty(box, "clientHeight", { value: 100 });
    document.body.append(box);
    expect(canScroll(box, 0, 10)).toBe(true);
    expect(canScroll(box, 0, -10)).toBe(false);
    expect(canScroll(document.getElementById("a"), 0, 10)).toBe(false);
  });

  it("reports Tab past the last control instead of keeping it", () => {
    const send = vi.fn();
    watchEdges(send);
    document.getElementById("c")!.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.getElementById("c")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledWith("focusOut", { dir: "next" });
    send.mockClear();
    document.getElementById("b")!.focus();
    const inside = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.getElementById("b")!.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
